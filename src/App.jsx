import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// API base URL
const API_BASE_URL = 'http://127.0.0.1:8000';

// Collection colors for badges
const COLLECTION_COLORS = {
  slack: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
  docs: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
  codebase: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  global: { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200' },
};

function App() {
  const [collections, setCollections] = useState([]);
  const [activeTab, setActiveTab] = useState('query');
  const [queryInput, setQueryInput] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [queryResults, setQueryResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [textToUpload, setTextToUpload] = useState('');
  const [uploadCollection, setUploadCollection] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null);
  const [folderToUpload, setFolderToUpload] = useState(null);
  const [folderUploadCollection, setFolderUploadCollection] = useState('');

  // Fetch available collections on load
  useEffect(() => {
    fetchCollections();
  }, []);

  const fetchCollections = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/collections`);
      setCollections(response.data.collections);
      if (response.data.collections.length > 0) {
        setSelectedCollection(response.data.collections[0]);
        setUploadCollection(response.data.collections[0]);
        setFolderUploadCollection(response.data.collections[0]);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    }
  };

  const handleQuerySubmit = async (e) => {
    e.preventDefault();
    if (!queryInput.trim()) return;

    setIsLoading(true);
    setQueryResults(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/query`, {
        query: queryInput,
        collection: selectedCollection === 'all' ? null : selectedCollection,
        top_k: 5
      });
      setQueryResults(response.data);
    } catch (error) {
      console.error('Error querying:', error);
      setQueryResults({
        answer: 'Error retrieving response. Please try again.',
        sources: []
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    setFileToUpload(e.target.files[0]);
  };

  const handleFolderUpload = (e) => {
    setFolderToUpload(e.target.files[0]);
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    
    if (!uploadCollection || ((!fileToUpload && !textToUpload.trim()))) {
      alert('Please select a collection and provide either a file or text to upload');
      return;
    }

    setIsLoading(true);
    setUploadStatus(null);

    const formData = new FormData();
    formData.append('collection', uploadCollection);
    
    if (fileToUpload) {
      formData.append('file', fileToUpload);
    } else {
      formData.append('text', textToUpload);
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/ingest`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setUploadStatus({
        success: true,
        message: `Successfully processed ${response.data.chunks_processed} chunks.`
      });
      // Reset form
      setFileToUpload(null);
      setTextToUpload('');
      document.getElementById('file-upload').value = '';
    } catch (error) {
      console.error('Error uploading document:', error);
      setUploadStatus({
        success: false,
        message: error.response?.data?.detail || 'Error uploading document. Please try again.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderUploadSubmit = async (e) => {
    e.preventDefault();
    
    if (!folderUploadCollection || !folderToUpload) {
      alert('Please select a collection and a zip file containing your folder.');
      return;
    }

    // Validate file size (100MB max)
    const maxSize = 100 * 1024 * 1024; // 100MB in bytes
    if (folderToUpload.size > maxSize) {
      setUploadStatus({
        success: false,
        message: `File size exceeds the 100MB limit. Current size: ${(folderToUpload.size / (1024 * 1024)).toFixed(2)}MB`
      });
      return;
    }

    setIsLoading(true);
    setUploadStatus({
      success: true,
      message: "Uploading folder... This may take a while for large files."
    });

    const formData = new FormData();
    formData.append('collection', folderUploadCollection);
    formData.append('folder_zip', folderToUpload);

    try {
      const response = await axios.post(`${API_BASE_URL}/ingest-folder`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // Add timeout for large files
        timeout: 300000, // 5 minutes
      });
      
      // Create a more detailed success message
      const result = response.data;
      setUploadStatus({
        success: true,
        message: `Successfully processed ${result.files_processed} files with ${result.total_chunks} chunks.${
          result.skipped_binary_files > 0 ? ` (${result.skipped_binary_files} binary files skipped)` : ''
        }${
          result.failed_files > 0 ? ` (${result.failed_files} files failed to process)` : ''
        }`,
        folderStructure: result.folder_structure
      });
      
      // Reset form
      setFolderToUpload(null);
      document.getElementById('folder-upload').value = '';
    } catch (error) {
      console.error('Error uploading folder:', error);
      setUploadStatus({
        success: false,
        message: error.response?.data?.detail || 'Error uploading folder. Please try again.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Create a recursive FolderStructure component to display nested folders
  const FolderStructure = ({ structure, depth = 0 }) => {
    const entries = Object.entries(structure);
    
    if (entries.length === 0) return null;
    
    return (
      <ul className={`pl-4 ${depth > 0 ? 'border-l border-gray-200 ml-1' : ''}`}>
        {entries.map(([key, value]) => {
          if (key === 'files') {
            return (
              <li key={key} className="py-1">
                <span className="font-medium text-gray-700">Files:</span>
                <ul className="pl-4">
                  {value.map((file, idx) => (
                    <li key={idx} className="text-gray-600 text-sm py-1 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      {file}
                    </li>
                  ))}
                </ul>
              </li>
            );
          } else {
            return (
              <li key={key} className="py-1">
                <div className="flex items-center font-medium text-gray-800">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  {key}
                </div>
                <FolderStructure structure={value} depth={depth + 1} />
              </li>
            );
          }
        })}
      </ul>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <header className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white shadow-md">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">MCP RAG System</h1>
          <p className="text-indigo-100 mt-1">Intelligent document retrieval powered by Qdrant & OpenAI</p>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <div className="flex space-x-2 mb-6">
          <button
            className={`px-5 py-2.5 rounded-t-lg font-medium transition-all duration-200 ${
              activeTab === 'query' ? 'bg-white shadow-md text-indigo-600 border-t-2 border-indigo-500' : 'bg-gray-200 hover:bg-gray-300'
            }`}
            onClick={() => setActiveTab('query')}
          >
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16l2.879-2.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Query Knowledge
            </span>
          </button>
          <button
            className={`px-5 py-2.5 rounded-t-lg font-medium transition-all duration-200 ${
              activeTab === 'upload' ? 'bg-white shadow-md text-indigo-600 border-t-2 border-indigo-500' : 'bg-gray-200 hover:bg-gray-300'
            }`}
            onClick={() => setActiveTab('upload')}
          >
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Document
            </span>
          </button>
          <button
            className={`px-5 py-2.5 rounded-t-lg font-medium transition-all duration-200 ${
              activeTab === 'folder' ? 'bg-white shadow-md text-indigo-600 border-t-2 border-indigo-500' : 'bg-gray-200 hover:bg-gray-300'
            }`}
            onClick={() => setActiveTab('folder')}
          >
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Upload Folder
            </span>
          </button>
        </div>
        
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
          {activeTab === 'query' ? (
            <div>
              <h2 className="text-2xl font-semibold mb-6 text-gray-800 border-b pb-2">Query Knowledge Base</h2>
              <form onSubmit={handleQuerySubmit}>
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">Select Knowledge Source:</label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedCollection('')}
                      className={`px-4 py-2 rounded-lg border transition-all ${
                        selectedCollection === '' 
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      All Collections
                    </button>
                    
                    {collections.map((collection) => (
                      <button
                        key={collection}
                        type="button"
                        onClick={() => setSelectedCollection(collection)}
                        className={`px-4 py-2 rounded-lg border transition-all ${
                          selectedCollection === collection 
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`inline-block w-3 h-3 rounded-full mr-2 ${COLLECTION_COLORS[collection]?.bg || 'bg-gray-300'}`}></span>
                        {collection.charAt(0).toUpperCase() + collection.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">Your Question:</label>
                  <textarea
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 transition-all"
                    rows="4"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    placeholder="What would you like to know?"
                  />
                </div>
                
                <button
                  type="submit"
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  disabled={isLoading || !queryInput.trim()}
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Submit Question
                    </>
                  )}
                </button>
              </form>
              
              {queryResults && (
                <div className="mt-10 border-t border-gray-200 pt-6">
                  <h3 className="text-xl font-semibold mb-4 text-gray-800">Answer:</h3>
                  <div className="bg-gradient-to-r from-gray-50 to-white p-6 rounded-lg border border-gray-200">
                    <ReactMarkdown
                      components={{
                        code({ node, inline, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={atomDark}
                              language={match[1]}
                              PreTag="div"
                              className="rounded-md my-3"
                              {...props}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={`${className} bg-gray-100 px-1.5 py-0.5 rounded text-gray-800`} {...props}>
                              {children}
                            </code>
                          );
                        },
                        h1: ({ node, ...props }) => <h1 className="text-2xl font-bold my-4" {...props} />,
                        h2: ({ node, ...props }) => <h2 className="text-xl font-bold my-3" {...props} />,
                        h3: ({ node, ...props }) => <h3 className="text-lg font-bold my-2" {...props} />,
                        p: ({ node, ...props }) => <p className="my-2" {...props} />,
                        ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-2" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-2" {...props} />,
                        li: ({ node, ...props }) => <li className="my-1" {...props} />,
                      }}
                      className="text-gray-700 prose prose-indigo max-w-none"
                    >
                      {queryResults.answer}
                    </ReactMarkdown>
                  </div>
                  
                  {queryResults.sources && queryResults.sources.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-xl font-semibold mb-3 text-gray-800">Sources:</h3>
                      <div className="grid gap-4 md:grid-cols-2">
                        {queryResults.sources.map((source, index) => {
                          const color = COLLECTION_COLORS[source.collection] || COLLECTION_COLORS.global;
                          return (
                            <div key={index} className="bg-white p-4 rounded-lg border shadow-sm">
                              <div className="flex items-center mb-2 justify-between">
                                <span className={`${color.bg} ${color.text} ${color.border} px-2.5 py-1 text-xs font-semibold rounded-full border`}>
                                  {source.collection}
                                </span>
                                <span className="text-sm text-gray-500">
                                  Match: <span className="font-medium">{(source.score * 100).toFixed(1)}%</span>
                                </span>
                              </div>
                              <div className="text-sm text-gray-700 line-clamp-4 bg-gray-50 p-3 rounded-md">
                                {source.text.length > 240 ? `${source.text.substring(0, 240)}...` : source.text}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'upload' ? (
            <div>
              <h2 className="text-2xl font-semibold mb-6 text-gray-800 border-b pb-2">Upload Documents</h2>
              <form onSubmit={handleUploadSubmit}>
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">Target Collection:</label>
                  <div className="flex flex-wrap gap-3">
                    {collections.filter(c => c !== 'global').map((collection) => (
                      <button
                        key={collection}
                        type="button"
                        onClick={() => setUploadCollection(collection)}
                        className={`px-4 py-2 rounded-lg border transition-all ${
                          uploadCollection === collection 
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`inline-block w-3 h-3 rounded-full mr-2 ${COLLECTION_COLORS[collection]?.bg || 'bg-gray-300'}`}></span>
                        {collection.charAt(0).toUpperCase() + collection.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">Upload File:</label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-indigo-300 transition-colors">
                    <div className="space-y-1 text-center">
                      <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="flex text-sm text-gray-600">
                        <label className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none">
                          <span>Upload a file</span>
                          <input 
                            id="file-upload" 
                            name="file-upload" 
                            type="file" 
                            className="sr-only" 
                            onChange={handleFileUpload}
                          />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-gray-500">Documents, PDFs, text files up to 10MB</p>
                    </div>
                  </div>
                  {fileToUpload && (
                    <div className="mt-2 text-sm text-gray-500 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{fileToUpload.name} selected</span>
                    </div>
                  )}
                </div>
                
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">
                    Or paste text:
                  </label>
                  <textarea
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 transition-all"
                    rows="6"
                    value={textToUpload}
                    onChange={(e) => setTextToUpload(e.target.value)}
                    placeholder="Paste your text content here..."
                  />
                </div>
                
                <button
                  type="submit"
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  disabled={
                    isLoading || 
                    !uploadCollection || 
                    ((!fileToUpload && !textToUpload.trim()))
                  }
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Upload Document
                    </>
                  )}
                </button>
              </form>
              
              {uploadStatus && (
                <div className={`mt-6 p-4 rounded-lg flex items-start ${
                  uploadStatus.success 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {uploadStatus.success ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <span>{uploadStatus.message}</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="text-2xl font-semibold mb-6 text-gray-800 border-b pb-2">Upload Folder (ZIP)</h2>
              <form onSubmit={handleFolderUploadSubmit}>
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">Target Collection:</label>
                  <div className="flex flex-wrap gap-3">
                    {collections.filter(c => c !== 'global').map((collection) => (
                      <button
                        key={collection}
                        type="button"
                        onClick={() => setFolderUploadCollection(collection)}
                        className={`px-4 py-2 rounded-lg border transition-all ${
                          folderUploadCollection === collection 
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`inline-block w-3 h-3 rounded-full mr-2 ${COLLECTION_COLORS[collection]?.bg || 'bg-gray-300'}`}></span>
                        {collection.charAt(0).toUpperCase() + collection.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="mb-6">
                  <label className="block text-gray-700 mb-2 font-medium">Upload Zipped Folder:</label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-indigo-300 transition-colors">
                    <div className="space-y-1 text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <div className="flex text-sm text-gray-600">
                        <label className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none">
                          <span>Upload a ZIP file</span>
                          <input 
                            id="folder-upload" 
                            name="folder-upload" 
                            type="file" 
                            accept=".zip"
                            className="sr-only" 
                            onChange={handleFolderUpload}
                          />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-gray-500">ZIP files containing folders with documents up to 100MB</p>
                      <p className="text-xs text-gray-500 mt-2">Supported files: .txt, .md, .py, .js, .html, .css, .json, .xml, .csv, .log, .rst, .java, .ts, .jsx, .tsx</p>
                    </div>
                  </div>
                  {folderToUpload && (
                    <div className="mt-2 text-sm text-gray-500 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{folderToUpload.name} selected ({(folderToUpload.size / (1024 * 1024)).toFixed(2)}MB)</span>
                    </div>
                  )}
                </div>
                
                <button
                  type="submit"
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  disabled={
                    isLoading || 
                    !folderUploadCollection || 
                    !folderToUpload
                  }
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Upload Folder
                    </>
                  )}
                </button>
              </form>
              
              {uploadStatus && (
                <div className={`mt-6 p-4 rounded-lg flex flex-col ${
                  uploadStatus.success 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  <div className="flex items-start">
                    {uploadStatus.success ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <span>{uploadStatus.message}</span>
                  </div>
                  
                  {uploadStatus.folderStructure && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Folder Structure Processed:</h4>
                      <div className="bg-white p-3 rounded-md border border-gray-200 max-h-80 overflow-auto">
                        <FolderStructure structure={uploadStatus.folderStructure} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      
      <footer className="mt-12 py-8 border-t bg-white">
        <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center">
          <div className="text-center md:text-left mb-4 md:mb-0">
            <h3 className="text-gray-800 font-bold">MCP RAG System</h3>
            <p className="text-gray-600 text-sm">Powered by Qdrant and OpenAI</p>
          </div>
          <div className="flex space-x-4">
            <a href="#" className="text-gray-600 hover:text-indigo-600 transition-colors">
              Documentation
            </a>
            <a href="#" className="text-gray-600 hover:text-indigo-600 transition-colors">
              GitHub
            </a>
            <a href="#" className="text-gray-600 hover:text-indigo-600 transition-colors">
              Support
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App; 