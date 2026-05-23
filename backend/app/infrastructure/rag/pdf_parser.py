import io

import fitz  # PyMuPDF

# Suppress non-fatal MuPDF structure warnings (e.g. "No common ancestor in structure tree")
# Fatal errors still raise exceptions; this only silences stderr diagnostic output.
fitz.TOOLS.mupdf_display_errors(False)

import pytesseract
from loguru import logger
from PIL import Image

from app.domain.rag.ports import DocumentParser


class PyMuPDFParser(DocumentParser):
    """Parses PDF, TXT, and MD files extracting raw text. Falls back to OCR for image-based PDFs."""

    async def parse(self, file_path: str, file_type: str) -> str:
        logger.info(f"Parsing document: {file_path} of type {file_type}")
        file_type = file_type.lower()

        if file_type in ["txt", "md"]:
            with open(file_path, encoding="utf-8") as f:
                return f.read()

        if file_type == "pdf":
            text = ""
            try:
                doc = fitz.open(file_path)
                for page_num in range(len(doc)):
                    page = doc.load_page(page_num)
                    page_text = page.get_text()

                    if not page_text.strip():
                        # Fallback to OCR if no text found
                        logger.warning(f"No text found on page {page_num}, falling back to OCR")
                        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                        img = Image.open(io.BytesIO(pix.tobytes()))
                        page_text = pytesseract.image_to_string(img)

                    text += page_text + "\n\n"
                doc.close()
                return text.strip()
            except Exception as e:
                logger.error(f"Failed to parse PDF {file_path}: {e}")
                raise ValueError(f"PDF Parsing failed: {e!s}")

        raise ValueError(f"Unsupported file type: {file_type}")

    async def parse_bytes(self, file_bytes: bytes, file_type: str) -> str:
        logger.info(f"Parsing document from bytes of type {file_type}")
        file_type = file_type.lower()

        if file_type in ["txt", "md"]:
            return file_bytes.decode("utf-8")

        if file_type == "pdf":
            text = ""
            try:
                doc = fitz.open(stream=file_bytes, filetype="pdf")
                for page_num in range(len(doc)):
                    page = doc.load_page(page_num)
                    page_text = page.get_text()

                    if not page_text.strip():
                        # Fallback to OCR if no text found
                        logger.warning(f"No text found on page {page_num}, falling back to OCR")
                        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                        img = Image.open(io.BytesIO(pix.tobytes()))
                        page_text = pytesseract.image_to_string(img)

                    text += page_text + "\n\n"
                doc.close()
                return text.strip()
            except Exception as e:
                logger.error(f"Failed to parse PDF bytes: {e}")
                raise ValueError(f"PDF Parsing failed: {e!s}")

        raise ValueError(f"Unsupported file type: {file_type}")
