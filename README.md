# PageXML Viewer
There are  great PageXML viewers out there:
- https://www.primaresearch.org/tools/PAGEViewer
- https://github.com/hnesk/browse-ocrd

I just wanted to add another, lightweight viewer, that can read in **multiple PageXML files** as well as a OCR-D workspace (simple parsing of METS file and displaying the file groups).

Moreover, it's possible to:
- edit or add transcriptions to existing TextLine elements and export the newly edited PageXML files.
- add, remove or edit TextRegion as well as TextLine elements
  

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

## Remark
ChatGPT 4.5, 5 as well as Claude Opus 4.5 have been used to generate this viewer.
Generated code has been manually tested and iteratively improved using the listed models.
