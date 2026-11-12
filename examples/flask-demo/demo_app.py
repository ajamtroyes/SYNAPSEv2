"""A small Flask app for showing the masked JSON at the end of Task B.

It lives outside the Flask checkout, so Task C's `git status` stays clean.
"""

from flask import Flask

app = Flask(__name__)
app.config.update(
    DEBUG_TOOLBAR=False,
    SITE_NAME="Forge-a-thon demo",
    SECRET_KEY="this-should-be-masked",
    DATABASE_PASSWORD="this-should-be-masked",
    API_TOKEN="this-should-be-masked",
    STRIPE_KEY="this-should-be-masked",
)
