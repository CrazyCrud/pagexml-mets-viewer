# app.py
from flask import Flask, render_template
from api.page import bp_page
from api.mets import bp_mets
from api.upload import bp_import
from api.file import bp_file


def create_app():
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.update(
        SECRET_KEY="dev",
        TEMPLATES_AUTO_RELOAD=True
    )

    app.register_blueprint(bp_page, url_prefix="/api")
    app.register_blueprint(bp_mets, url_prefix="/api")
    app.register_blueprint(bp_import, url_prefix="/api")
    app.register_blueprint(bp_file, url_prefix="/api")

    @app.get("/")
    def index():
        return render_template("index.html")

    return app


# Expose a module-level WSGI app object for Gunicorn
app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
