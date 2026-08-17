# Hiring Agent

<p align="center"><strong>Resume-to-Score pipeline & Interactive Web UI</strong> that extracts structured data from PDFs, enriches candidate profiles with GitHub signals, and outputs objective, explainable evaluations.</p>

<p align="center">
  <a href="https://www.python.org/downloads/release/python-3110/">
    <img alt="Python" src="https://img.shields.io/badge/python-3.11%2B-blue.svg">
  </a>
  <a href="https://github.com/Komal-ai417/hiring-agent/blob/master/LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-yellow.svg">
  </a>
  <a href="https://github.com/psf/black">
    <img alt="Code style: Black" src="https://img.shields.io/badge/code%20style-Black-000000.svg">
  </a>
</p>

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation and Setup](#installation-and-setup)
  - [Prerequisites](#prerequisites)
  - [Quick setup with pip](#quick-setup-with-pip)
- [Running the Web UI](#running-the-web-ui)
- [CLI Usage](#cli-usage)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Directory Layout](#directory-layout)
- [License](#license)

---

## Overview

Hiring Agent parses resume PDFs to Markdown, extracts sectioned JSON using local or hosted LLMs (Google Gemini, Ollama, etc.), augments data with GitHub profile and repository signals, and produces transparent evaluations complete with category scores, evidence, bonus points, and deductions.

---

## Features

- **Interactive Web Interface**: Clean, warm dark-themed UI with drag-and-drop resume upload and live SSE progress streaming.
- **Section Parsing**: Converts unstructured PDFs into standardized JSON Resume format.
- **GitHub Enrichment**: Fetches public activity, scores repositories, and evaluates contribution depth.
- **Customizable Rubrics**: Easily add and adjust scoring weights, categories, and criteria per role.
- **Multi-Provider Support**: Switch seamlessly between cloud models (Gemini) and local offline models (Ollama).

---

## Architecture

<table>
<tr>
<td>

**Flow**

1. `pymupdf_rag.py` converts PDF pages to structured Markdown text.
2. `pdf.py` calls the LLM per section using Jinja templates under `prompts/templates`.
3. `github.py` fetches profiles and repos, classifying top project contributions.
4. `evaluator.py` executes structured scoring against defined role rubrics.
5. `app.py` serves the Flask application and streams evaluation progress in real-time.

</td>
<td>

**Key modules**

- `app.py`: Flask web server with SSE streaming endpoints.
- `models.py`: Pydantic schemas and LLM provider interfaces.
- `llm_utils.py`: Provider initialization and response normalization.
- `transform.py`: Normalization to standard JSON Resume format.
- `prompts/`: Jinja templates for parsing, analysis, and scoring.

</td>
</tr>
</table>

---

## Installation and Setup

### Prerequisites

- **Python 3.11+**
- **LLM Backend**:
  - **Google Gemini** (Recommended for cloud deployment): Get an API key from [Google AI Studio](https://aistudio.google.com/api-keys).
  - **Ollama** (For local/offline models): Download from [ollama.com](https://ollama.com/).

### Quick setup with pip

```bash
$ git clone https://github.com/Komal-ai417/hiring-agent.git
$ cd hiring-agent

$ python -m venv .venv
# Linux or macOS
$ source .venv/bin/activate
# Windows
# .venv\Scripts\activate

$ pip install -r requirements.txt
```

---

## Running the Web UI

To start the local web interface:

```bash
python app.py
```

Then open your browser and navigate to **`http://localhost:5000`**.

---

## CLI Usage

You can also run evaluations directly from the command line:

```bash
$ python score.py ./resume/sample.pdf --role software_engineering_intern
```

### Roles

Roles bundle criteria in `roles/<role_name>/`:
- `role.json`: Category definitions, maximum weights, and bounds.
- `criteria.jinja`: Rubric instructions and evaluation logic.
- `system_message.jinja`: Fairness principles and constraints.

To scaffold a new role:

```bash
$ python score.py --init-role backend_engineer
```

---

## Configuration

Copy `.env.example` to `.env` and set your credentials:

```bash
$ cp .env.example .env
```

| Variable | Description |
|---|---|
| `DEFAULT_MODEL` | The default model to use (e.g. `gemini-2.5-flash` or `gemma4:latest`). |
| `GEMINI_API_KEY` | Your Google AI Studio API key (required when using Gemini). |
| `GITHUB_TOKEN` | Optional GitHub Personal Access Token to increase API rate limits. |

---

## Deployment

### Deploying to Render.com

This repository includes a `render.yaml` blueprint ready for one-click deployment:

1. Push your repository to GitHub.
2. Sign in to [Render.com](https://render.com) and click **New +** → **Blueprint**.
3. Select your repository.
4. Set the **`GEMINI_API_KEY`** environment variable under the service settings.
5. Click **Apply** to deploy.

---

## Directory Layout

```text
.
├── app.py                  # Flask web server
├── config.py               # Provider and environment configuration
├── evaluator.py            # Rubric evaluator
├── github.py               # GitHub signal extraction
├── llm_utils.py            # LLM provider initialization
├── models.py               # Pydantic models
├── pdf.py                  # PDF parser and section extractor
├── providers.json          # Provider configurations and models
├── pymupdf_rag.py          # PDF to Markdown conversion engine
├── render.yaml             # Render deployment configuration
├── requirements.txt        # Python dependencies
├── roles.py                # Role manager
├── roles/                  # Role evaluation definitions
├── static/                 # CSS & JS web assets
├── templates/              # HTML templates
└── transform.py            # Data transformations
```

---

## License

[MIT](https://github.com/Komal-ai417/hiring-agent/blob/master/LICENSE)
