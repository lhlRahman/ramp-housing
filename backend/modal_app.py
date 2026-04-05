"""Modal deployment wrapper for the Ramp Housing API."""

import modal

app = modal.App("ramp-housing")

# Persistent volume for SQLite database
volume = modal.Volume.from_name("ramp-housing-data", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi>=0.115,<1",
        "uvicorn[standard]>=0.34,<1",
        "httpx>=0.27,<1",
        "playwright>=1.49,<2",
        "beautifulsoup4>=4.12,<5",
        "lxml>=5.3,<6",
        "shapely>=2.0,<3",
        "pydantic>=2.10,<3",
        "python-dotenv>=1.0,<2",
        "python-multipart>=0.0.20,<1",
        "websockets>=14.0,<15",
    )
    .run_commands("playwright install --with-deps chromium")
    .add_local_dir(".", remote_path="/app", ignore=["venv", ".next*", "__pycache__", "*.pyc", ".git"])
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("ramp-housing-secrets")],
    volumes={"/data": volume},
    scaledown_window=300,
    timeout=900,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def api():
    import os

    # Point SQLite to the persistent volume
    os.environ.setdefault("DB_PATH", "/data/geocache.db")
    # Ensure headless mode
    os.environ.setdefault("BROWSER_HEADLESS", "true")

    # Import the FastAPI app (from /app which is our backend dir)
    import sys
    sys.path.insert(0, "/app")

    from main import app as fastapi_app

    return fastapi_app
