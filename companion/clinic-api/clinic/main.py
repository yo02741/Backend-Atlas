"""uvicorn 的進入點：uvicorn clinic.main:app"""

from clinic.app import create_app

app = create_app()
