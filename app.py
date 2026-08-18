"""Hiring Agent — Flask Web UI.

Wraps the existing CLI scoring pipeline in a web server. Supports:
- PDF upload via drag-and-drop
- Role selection from available roles
- Server-Sent Events (SSE) for real-time progress
- Full evaluation results as JSON
"""

import os
import sys
import json
import uuid
import shutil
import logging
import threading
import queue
import tempfile
from pathlib import Path

# Fix for Windows Console Unicode errors
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

# Fix for Python 3.14 Protobuf TypeError
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

from flask import Flask, request, jsonify, render_template, Response

# ── Import from the existing hiring-agent pipeline ──────────────────────
from pdf import PDFHandler
from github import fetch_and_display_github_info
from models import JSONResume, build_evaluation_model
from evaluator import ResumeEvaluator
from roles import list_available_roles, load_role
from prompt import DEFAULT_MODEL, MODEL_PARAMETERS
from transform import (
    transform_evaluation_response,
    convert_json_resume_to_text,
    convert_github_data_to_text,
    convert_blog_data_to_text,
)
from config import DEVELOPMENT_MODE

# ── App setup ───────────────────────────────────────────────────────────
app = Flask(__name__)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)5s - %(lineno)5d - %(funcName)33s - %(levelname)5s - %(message)s",
)


# ── Routes ──────────────────────────────────────────────────────────────


@app.route("/")
def index():
    """Serve the single-page UI."""
    return render_template("index.html")


@app.route("/api/roles", methods=["GET"])
def get_roles():
    """Return list of available evaluation roles."""
    roles = list_available_roles()

    roles_data = []
    for r in roles:
        try:
            role = load_role(r)
            roles_data.append({"id": r, "title": role.position_title})
        except Exception:
            roles_data.append({"id": r, "title": r.replace("_", " ").title()})

    # Sort: software_engineering_intern first, then others alphabetically
    roles_data.sort(
        key=lambda x: (0 if x["id"] == "software_engineering_intern" else 1, x["title"])
    )

    return jsonify({"roles": roles_data})


@app.route("/api/evaluate", methods=["POST"])
def evaluate():
    """Accept a PDF upload + role name, run the pipeline, stream progress via SSE."""

    # Validate inputs
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Please upload a PDF file"}), 400

    role_name = request.form.get("role")
    if not role_name:
        return jsonify({"error": "Please select a role"}), 400

    try:
        role = load_role(role_name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Save uploaded file to temp location
    job_id = uuid.uuid4().hex[:12]
    save_dir = UPLOAD_DIR / job_id
    save_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = save_dir / file.filename
    file.save(str(pdf_path))

    # Create a queue for SSE progress events
    progress_queue = queue.Queue()

    def run_pipeline():
        """Run the full scoring pipeline in a background thread, pushing events."""
        try:
            # ── Step 1: Extract PDF ──
            progress_queue.put(
                (
                    "progress",
                    {
                        "step": "extract",
                        "message": "Extracting data from PDF…",
                        "percent": 10,
                    },
                )
            )

            evaluation_model = build_evaluation_model(role)

            # Check for cached resume data
            cache_filename = f"cache/resumecache_{pdf_path.stem}.json"
            resume_data = None
            cache_loaded = False

            if DEVELOPMENT_MODE and os.path.exists(cache_filename):
                try:
                    cached_data = json.loads(
                        Path(cache_filename).read_text(encoding="utf-8")
                    )
                    loaded_resume = JSONResume(**cached_data)
                    # Validate
                    core = [
                        loaded_resume.basics,
                        loaded_resume.work,
                        loaded_resume.education,
                        loaded_resume.skills,
                        loaded_resume.projects,
                    ]
                    if any(s is not None for s in core):
                        resume_data = loaded_resume
                        cache_loaded = True
                except Exception:
                    pass

            if not cache_loaded:
                pdf_handler = PDFHandler()
                resume_data = pdf_handler.extract_json_from_pdf(str(pdf_path))

                if resume_data is None:
                    progress_queue.put(
                        (
                            "error",
                            {
                                "error": "Failed to extract data from the PDF. The file may be corrupted or contain no readable text."
                            },
                        )
                    )
                    return

                # Cache if dev mode
                if DEVELOPMENT_MODE:
                    core = [
                        resume_data.basics,
                        resume_data.work,
                        resume_data.education,
                        resume_data.skills,
                        resume_data.projects,
                    ]
                    if any(s is not None for s in core):
                        os.makedirs(os.path.dirname(cache_filename), exist_ok=True)
                        Path(cache_filename).write_text(
                            json.dumps(
                                resume_data.model_dump(), indent=2, ensure_ascii=False
                            ),
                            encoding="utf-8",
                        )

            progress_queue.put(
                (
                    "progress",
                    {
                        "step": "github",
                        "message": "Fetching GitHub profile…",
                        "percent": 35,
                    },
                )
            )

            # ── Step 2: GitHub enrichment ──
            github_cache_filename = f"cache/githubcache_{pdf_path.stem}.json"
            github_data = {}
            github_cache_loaded = False

            if DEVELOPMENT_MODE and os.path.exists(github_cache_filename):
                try:
                    loaded = json.loads(
                        Path(github_cache_filename).read_text(encoding="utf-8")
                    )
                    if isinstance(loaded, dict) and loaded and "profile" in loaded:
                        github_data = loaded
                        github_cache_loaded = True
                except Exception:
                    pass

            if not github_cache_loaded:
                profiles = []
                if (
                    resume_data
                    and hasattr(resume_data, "basics")
                    and resume_data.basics
                ):
                    profiles = resume_data.basics.profiles or []

                github_profile = next(
                    (
                        p
                        for p in profiles
                        if p.network and p.network.lower() == "github"
                    ),
                    None,
                )

                if github_profile:
                    github_data = fetch_and_display_github_info(
                        github_profile.url, position_title=role.position_title
                    )
                    if (
                        DEVELOPMENT_MODE
                        and github_data
                        and isinstance(github_data, dict)
                        and "profile" in github_data
                    ):
                        os.makedirs(
                            os.path.dirname(github_cache_filename), exist_ok=True
                        )
                        Path(github_cache_filename).write_text(
                            json.dumps(github_data, indent=2, ensure_ascii=False),
                            encoding="utf-8",
                        )

            progress_queue.put(
                (
                    "progress",
                    {
                        "step": "evaluate",
                        "message": "Running AI evaluation…",
                        "percent": 55,
                    },
                )
            )

            # ── Step 3: Evaluate ──
            model_params = MODEL_PARAMETERS.get(DEFAULT_MODEL)
            evaluator = ResumeEvaluator(
                role=role,
                evaluation_model=evaluation_model,
                model_name=DEFAULT_MODEL,
                model_params=model_params,
            )

            resume_text = convert_json_resume_to_text(resume_data)
            if github_data:
                resume_text += convert_github_data_to_text(github_data)

            evaluation_result = evaluator.evaluate_resume(resume_text)

            progress_queue.put(
                (
                    "progress",
                    {
                        "step": "complete",
                        "message": "Generating results…",
                        "percent": 90,
                    },
                )
            )

            # ── Build response ──
            candidate_name = pdf_path.stem
            if (
                resume_data
                and hasattr(resume_data, "basics")
                and resume_data.basics
                and resume_data.basics.name
            ):
                candidate_name = resume_data.basics.name

            # Serialize evaluation result
            eval_dict = evaluation_result.model_dump()

            # Build role info for the frontend
            role_info = {
                "name": role.name,
                "position_title": role.position_title,
                "categories": [
                    {"key": c.key, "label": c.label, "max": c.max, "icon": c.icon}
                    for c in role.categories
                ],
                "bonus_max": role.bonus_max,
                "min_final_score": role.min_final_score,
                "max_final_score": role.max_final_score,
            }

            progress_queue.put(
                (
                    "result",
                    {
                        "evaluation": eval_dict,
                        "candidate_name": candidate_name,
                        "role_info": role_info,
                    },
                )
            )

        except Exception as e:
            logger.exception("Pipeline error")
            progress_queue.put(("error", {"error": f"Evaluation failed: {str(e)}"}))
        finally:
            # Cleanup uploaded file
            try:
                shutil.rmtree(save_dir, ignore_errors=True)
            except Exception:
                pass

    # Start pipeline in background thread
    thread = threading.Thread(target=run_pipeline, daemon=True)
    thread.start()

    # Stream SSE events
    def generate_sse():
        while True:
            try:
                event_type, data = progress_queue.get(timeout=300)  # 5 min timeout
                yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                if event_type in ("result", "error"):
                    break
            except queue.Empty:
                # Timeout — send error
                yield f"event: error\ndata: {json.dumps({'error': 'Evaluation timed out after 5 minutes.'})}\n\n"
                break

    return Response(
        generate_sse(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n  🚀 Hiring Agent Web UI")
    print("  ─────────────────────")
    print("  Open http://localhost:5000 in your browser\n")
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
