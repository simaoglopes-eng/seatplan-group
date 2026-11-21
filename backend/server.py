"""Vercel entrypoint for the backend service."""

from app.main import create_app

app = create_app()
