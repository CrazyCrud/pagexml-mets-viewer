from flask import Flask, render_template
from api.page import bp_page
from api.mets import bp_mets
from api.upload import bp_import
from api.file import bp_file


def create_app():
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.update(
        SECRET_KEY="dev",  # replace in production
        TEMPLATES_AUTO_RELOAD=True  # set False in production
    )

    # Register blueprints under a common API prefix
    app.register_blueprint(bp_page, url_prefix="/api")
    app.register_blueprint(bp_mets, url_prefix="/api")
    app.register_blueprint(bp_import, url_prefix="/api")
    app.register_blueprint(bp_file, url_prefix="/api")

    @app.get("/")
    def index():
        return render_template("index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True)
