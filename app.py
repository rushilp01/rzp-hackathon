import os
import glob
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from openai import OpenAI
import httpx
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams
from dotenv import load_dotenv
import uuid
import tempfile
import shutil
import zipfile

# Load environment variables
load_dotenv()

# FastAPI application with increased file size limit
app = FastAPI()

# Configure CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client with custom HTTP client to avoid proxy issues
http_client = httpx.Client()
openai_client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    http_client=http_client
)
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSION = 1536
CHAT_MODEL = "gpt-3.5-turbo"

# Initialize Qdrant client
qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
qdrant_client = QdrantClient(url=qdrant_url)

# Collection names
COLLECTIONS = ["slack", "docs", "codebase"]

# Data models
class QueryRequest(BaseModel):
    query: str
    collection: Optional[str] = None
    top_k: int = 5

class DocumentIngestionRequest(BaseModel):
    collection: str
    text: str
    metadata: Optional[Dict[str, Any]] = None

# Setup collections function
def ensure_collections_exist():
    """Ensure all required collections exist in Qdrant"""
    collections_info = qdrant_client.get_collections()
    existing_collections = [c.name for c in collections_info.collections]
    
    for collection in COLLECTIONS:
        if collection not in existing_collections:
            qdrant_client.create_collection(
                collection_name=collection,
                vectors_config=VectorParams(size=EMBEDDING_DIMENSION, distance=Distance.COSINE),
            )
            print(f"Created collection: {collection}")

# Ensure collections exist on startup
@app.on_event("startup")
async def startup_event():
    ensure_collections_exist()

# Get embedding for text
def get_embedding(text: str) -> List[float]:
    response = openai_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text
    )
    return response.data[0].embedding

# Chunk text function
def chunk_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> List[str]:
    """Split text into chunks of specified size with overlap"""
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        # Try to find a natural break point like newline or period
        if end < len(text):
            for break_char in ['\n\n', '\n', '. ', ' ']:
                last_break = text[start:end].rfind(break_char)
                if last_break != -1:
                    end = start + last_break + len(break_char)
                    break
        
        chunks.append(text[start:end])
        start = max(start + chunk_size - chunk_overlap, end - chunk_overlap)
    
    return chunks

# API endpoints
@app.post("/ingest")
async def ingest_document(
    collection: str = Form(...),
    file: UploadFile = File(None),
    text: str = Form(None),
    metadata: Dict[str, Any] = Form({})
):
    """Ingest a document into the specified collection"""
    if collection not in COLLECTIONS:
        raise HTTPException(status_code=400, detail=f"Collection must be one of {COLLECTIONS}")
    
    document_text = ""
    # Get text from either file or direct input
    if file:
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name
            
        with open(temp_path, 'r', encoding='utf-8', errors='ignore') as f:
            document_text = f.read()
        os.unlink(temp_path)
        
        # Add filename to metadata
        metadata["filename"] = file.filename
    elif text:
        document_text = text
    else:
        raise HTTPException(status_code=400, detail="Either file or text must be provided")
    
    # Process document - chunk it and create embeddings
    chunks = chunk_text(document_text)
    
    points = []
    for i, chunk in enumerate(chunks):
        chunk_id = str(uuid.uuid4())
        embedding = get_embedding(chunk)
        
        chunk_metadata = {
            "text": chunk,
            "chunk_index": i,
            "total_chunks": len(chunks),
            **metadata
        }
        
        points.append(models.PointStruct(
            id=chunk_id,
            vector=embedding,
            payload=chunk_metadata
        ))
    
    # Upload points to Qdrant in batches if needed
    if points:
        qdrant_client.upsert(
            collection_name=collection,
            points=points
        )
    
    return {"status": "success", "chunks_processed": len(chunks)}

@app.post("/ingest-folder")
async def ingest_folder(
    collection: str = Form(...),
    folder_zip: UploadFile = File(...),
    metadata: Dict[str, Any] = Form({})
):
    """Ingest all documents from a zipped folder into the specified collection"""
    if collection not in COLLECTIONS:
        raise HTTPException(status_code=400, detail=f"Collection must be one of {COLLECTIONS}")
    
    # Create a temporary directory to extract the zip file
    temp_dir = tempfile.mkdtemp()
    temp_zip_path = os.path.join(temp_dir, "upload.zip")
    
    try:
        # Save the uploaded zip file in chunks to handle large files
        with open(temp_zip_path, "wb") as temp_zip:
            # Read and write in larger chunks (8MB) for better performance with big files
            chunk_size = 8 * 1024 * 1024  # 8MB
            while True:
                chunk = await folder_zip.read(chunk_size)
                if not chunk:
                    break
                temp_zip.write(chunk)
        
        print(f"Zip file saved to {temp_zip_path}, size: {os.path.getsize(temp_zip_path)} bytes")
        
        # Extract the zip file
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
            
        print(f"Zip file extracted to {temp_dir}")
        
        # Define supported file extensions for text processing
        supported_extensions = [
            '.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.xml', '.csv', '.log',
            '.rst', '.java', '.ts', '.jsx', '.tsx', '.c', '.cpp', '.h', '.hpp', '.sh',
            '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sql', '.graphql', '.go'
        ]
        
        # Walk through all directories and find files with supported extensions
        files_to_process = []
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                if file == "upload.zip":  # Skip the original zip file
                    continue
                    
                file_path = os.path.join(root, file)
                file_ext = os.path.splitext(file)[1].lower()
                
                # Only process text-based files with supported extensions
                if file_ext in supported_extensions:
                    files_to_process.append(file_path)
        
        if not files_to_process:
            return {"status": "error", "message": "No supported files found in the uploaded folder"}
        
        print(f"Found {len(files_to_process)} files to process")
        
        total_chunks = 0
        processed_files = 0
        failed_files = 0
        skipped_binary_files = 0
        folder_structure = {}
        
        # Process each file
        for file_path in files_to_process:
            try:
                # Get relative path to use as part of metadata
                rel_path = os.path.relpath(file_path, temp_dir)
                
                # Track folder structure for visualization
                path_parts = rel_path.split(os.sep)
                current_level = folder_structure
                
                # Build folder structure dictionary
                for i, part in enumerate(path_parts[:-1]):  # All except the last one (which is the file)
                    if part not in current_level:
                        current_level[part] = {}
                    current_level = current_level[part]
                
                # Add file to the structure
                file_name = path_parts[-1]
                if 'files' not in current_level:
                    current_level['files'] = []
                current_level['files'].append(file_name)
                
                # Determine file type and process accordingly
                file_ext = os.path.splitext(file_path)[1][1:].lower()  # File extension without dot
                
                # Try to read the file as text
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        file_content = f.read()
                    
                    # Skip empty files
                    if not file_content.strip():
                        skipped_binary_files += 1
                        continue
                    
                    # Create folder hierarchy path for metadata
                    folder_path = os.path.dirname(rel_path)
                    
                    # Create file-specific metadata
                    file_metadata = {
                        **metadata,
                        "filename": os.path.basename(file_path),
                        "path": rel_path,
                        "folder_path": folder_path,
                        "file_type": file_ext,
                        "folder_depth": len(path_parts) - 1  # How deep in the folder structure
                    }
                    
                    # Process document - chunk it and create embeddings
                    chunks = chunk_text(file_content)
                    
                    points = []
                    for i, chunk in enumerate(chunks):
                        chunk_id = str(uuid.uuid4())
                        embedding = get_embedding(chunk)
                        
                        chunk_metadata = {
                            "text": chunk,
                            "chunk_index": i,
                            "total_chunks": len(chunks),
                            **file_metadata
                        }
                        
                        points.append(models.PointStruct(
                            id=chunk_id,
                            vector=embedding,
                            payload=chunk_metadata
                        ))
                    
                    # Upload points to Qdrant in batches if needed
                    if points:
                        qdrant_client.upsert(
                            collection_name=collection,
                            points=points
                        )
                    
                    total_chunks += len(chunks)
                    processed_files += 1
                    
                except UnicodeDecodeError:
                    # This is likely a binary file, skip it
                    skipped_binary_files += 1
                    print(f"Skipping binary file: {rel_path}")
                    continue
                
            except Exception as e:
                print(f"Error processing file {file_path}: {e}")
                failed_files += 1
                # Continue with next file instead of failing the entire process
        
        return {
            "status": "success", 
            "files_processed": processed_files,
            "total_chunks": total_chunks,
            "failed_files": failed_files,
            "skipped_binary_files": skipped_binary_files,
            "folder_structure": folder_structure
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing folder: {str(e)}")
    
    finally:
        # Clean up temporary directory
        shutil.rmtree(temp_dir)

@app.post("/query")
async def query(request: QueryRequest):
    """Query documents from collections or use global knowledge"""
    query_embedding = get_embedding(request.query)
    
    # Search in specific collection if provided, otherwise search all
    search_results = []
    
    if request.collection and request.collection in COLLECTIONS:
        # Search in specific collection
        results = qdrant_client.search(
            collection_name=request.collection,
            query_vector=query_embedding,
            limit=request.top_k
        )
        for res in results:
            search_results.append({
                "text": res.payload.get("text", ""),
                "score": res.score,
                "collection": request.collection,
                "metadata": {k: v for k, v in res.payload.items() if k != "text"}
            })
    elif request.collection == "global":
        # Just use OpenAI without context
        pass
    else:
        # Search across all collections
        for collection in COLLECTIONS:
            try:
                results = qdrant_client.search(
                    collection_name=collection,
                    query_vector=query_embedding,
                    limit=max(1, request.top_k // len(COLLECTIONS))
                )
                for res in results:
                    search_results.append({
                        "text": res.payload.get("text", ""),
                        "score": res.score,
                        "collection": collection,
                        "metadata": {k: v for k, v in res.payload.items() if k != "text"}
                    })
            except Exception as e:
                print(f"Error searching collection {collection}: {e}")
    
    # Sort results by score
    search_results.sort(key=lambda x: x["score"], reverse=True)
    search_results = search_results[:request.top_k]
    
    # Prepare context for OpenAI
    context = "\n\n".join([f"[{r['collection']}] {r['text']}" for r in search_results])
    
    if not context.strip() and request.collection != "global":
        response = {"answer": "No relevant information found in the collections. Try querying 'global' knowledge."}
    else:
        # Generate response using OpenAI
        messages = []
        
        if context.strip():
            messages.append({
                "role": "system", 
                "content": f"You are a helpful assistant that answers questions based on the context provided.\n\nContext:\n{context}"
            })
        else:
            messages.append({
                "role": "system", 
                "content": "You are a helpful assistant. Answer the following question using your general knowledge."
            })
        
        messages.append({"role": "user", "content": request.query})
        
        chat_response = openai_client.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
            temperature=0.7,
        )
        
        answer = chat_response.choices[0].message.content
        response = {
            "answer": answer,
            "sources": search_results
        }
    
    return response

@app.get("/collections")
async def list_collections():
    """List all available collections"""
    return {"collections": COLLECTIONS + ["global"]}

if __name__ == "__main__":
    # Run FastAPI app with proper configuration for large file uploads
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000, 
        limit_concurrency=20,
        timeout_keep_alive=300
    ) 