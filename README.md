# PageXML Viewer
There are  great PageXML viewers out there:
- https://www.primaresearch.org/tools/PAGEViewer
- https://github.com/hnesk/browse-ocrd

I just wanted to add another, lightweight viewer, that can read in **multiple PageXML files** as well as a OCR-D workspace (*TODO*).

![myimage](screenshot.png?raw=true)    

# Installation
## Pip
```commandline
pip install -r requirements
```
And then run `python app.py`. The app runs then under http://127.0.0.1:5000.    

## Docker
```commandline
docker compose up --build
```
The app runs under http://127.0.0.1:8000/.
