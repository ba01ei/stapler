# PDF Merge CLI

A command-line tool to merge PDF files and images from Google Drive URLs into a single PDF document.

## Quick Start

```bash
npm install
npm run interactive
```

Then follow the prompts to merge your files!

## Features

- ✅ **Interactive mode** - Guided experience with prompts and continuous operation
- ✅ **Direct command mode** - One-time usage for scripting and automation
- ✅ Download files from publicly shared Google Drive URLs
- ✅ Support for PDF files and common image formats (PNG, JPG, JPEG, GIF, BMP, WEBP)
- ✅ Automatic image-to-PDF conversion with EXIF orientation correction
- ✅ Merge multiple PDFs into a single document
- ✅ **Pre-flight permission checking** - validates all URLs before processing
- ✅ Command-line interface with progress indicators
- ✅ Automatic cleanup of temporary files
- ✅ Smart edge case handling (single URL detection)
- ✅ **Flexible input formats** - space, comma, newline separated URLs

## Installation

1. Clone or download this project
2. Install dependencies:

```bash
npm install
```

3. Make the script executable (optional):

```bash
chmod +x index.js
```

## Usage

### Interactive Mode (Recommended)

Start the interactive mode for a guided experience:

```bash
# Using npm (simplest)
npm run interactive
# or even shorter:
npm run i

# Using node directly
node index.js interactive
# or use the short alias:
node index.js i
```

The interactive mode will:
1. **Prompt for URLs**: Enter multiple Google Drive URLs with flexible formatting
2. **Ask for filename**: Specify the output filename (without .pdf extension)  
3. **Process and merge**: Automatically handle downloading, conversion, and merging
4. **Repeat**: Continue with new merges until you press Ctrl+C to exit
5. **Error handling**: If there are issues, you can try again without restarting

**Interactive Mode Workflow:**
```
🚀 PDF Merge CLI - Interactive Mode
=====================================
Welcome! This tool will help you merge PDF files and images from Google Drive URLs.
Press Ctrl+C anytime to exit.

📋 Step 1: Provide Google Drive URLs
────────────────────────────────────
🔗 Enter Google Drive URLs (publicly shared):
💡 Tip: You can paste multiple URLs separated by spaces, commas, or newlines
📝 Press Enter twice when done, or type 'done' on a new line:

[Enter your URLs here]

✅ Found 3 URLs to process

📝 Step 2: Choose output filename
──────────────────────────────────
📄 Enter output filename (without .pdf extension): my-merged-document

🔄 Processing 3 files...
[Processing output...]
🎉 Success! Ready for next merge.
```

### Direct Command Mode

For one-time usage or scripting:

```bash
node index.js "<urls>" [options]
```

The URLs can be provided as a single string with multiple separators:

- **Space separated**: `"url1 url2 url3"`
- **Newline separated**: `"url1\nurl2\nurl3"`
- **Comma separated**: `"url1, url2, url3"`
- **Mixed separators**: Any combination of the above

### Examples

```bash
# Space separated URLs (outputs to output/merged.pdf by default)
node index.js "https://drive.google.com/file/d/1ABC123/view https://drive.google.com/file/d/2DEF456/view"

# Comma separated URLs with custom output using -o
node index.js "https://drive.google.com/file/d/1ABC123/view, https://drive.google.com/file/d/2DEF456/view" -o my-merged-document.pdf

# Using the short -n option for quick filename (saves to output/1234.pdf)
node index.js "https://drive.google.com/file/d/1ABC123/view, https://drive.google.com/file/d/2DEF456/view" -n 1234

# Newline separated URLs (saves to output/final-document.pdf)
node index.js "https://drive.google.com/file/d/1ABC123/view
https://drive.google.com/file/d/2DEF456/view
https://drive.google.com/file/d/3GHI789/view" --name final-document

# Mixed separators with short filename (saves to output/report-2024.pdf)
node index.js "https://drive.google.com/file/d/1ABC123/view, https://drive.google.com/file/d/2DEF456/view
https://drive.google.com/file/d/3GHI789/view" -n report-2024

# Single URL - will show informational message and exit (no processing)
node index.js "https://drive.google.com/file/d/1ABC123/view"
```

### Options

- `-o, --output <path>`: Specify the output PDF file path (default: `output/merged.pdf`)
- `-n, --name <filename>`: Specify output filename without .pdf extension (saves to `output/filename.pdf`)
- `-h, --help`: Display help information
- `-V, --version`: Display version number

**Note:**

- All output files are saved to the `output/` directory by default
- If both `-o` and `-n` are provided, `-n` takes precedence
- The `output/` directory is created automatically if it doesn't exist

### Input Format Flexibility

The tool accepts URLs in a single string with flexible separators:

- **Spaces**: Separate URLs with single or multiple spaces
- **Newlines**: Separate URLs with line breaks (useful for copy-pasting lists)
- **Commas**: Separate URLs with commas (with or without spaces)
- **Mixed**: Any combination of the above separators

This makes it easy to:

- Copy-paste a list of URLs from a spreadsheet or document
- Use the tool in scripts with dynamically generated URL lists
- Handle URLs formatted in various ways

## Google Drive URL Requirements

The Google Drive files must be **publicly shared**. The tool supports various Google Drive URL formats:

- `https://drive.google.com/file/d/FILE_ID/view`
- `https://drive.google.com/open?id=FILE_ID`
- `https://drive.google.com/file/d/FILE_ID/edit`

### How to Share a Google Drive File Publicly

1. Right-click on the file in Google Drive
2. Select "Share"
3. Click "Change to anyone with the link"
4. Set permission to "Viewer"
5. Copy the shareable link

## Supported File Types

### PDF Files

- `.pdf` - Portable Document Format

### Image Files

- `.png` - Portable Network Graphics
- `.jpg` / `.jpeg` - Joint Photographic Experts Group
- `.gif` - Graphics Interchange Format
- `.bmp` - Bitmap Image File
- `.webp` - WebP Image Format

Images are automatically converted to PDF pages with the following features:

- **Automatic orientation correction** based on EXIF data
- **High-quality conversion** maintaining aspect ratio
- **Optimal page sizing** to fit image dimensions

## Dependencies

- **pdf-lib**: PDF manipulation and merging
- **axios**: HTTP client for downloading files
- **sharp**: High-performance image processing
- **commander**: Command-line interface framework
- **fs-extra**: Enhanced file system operations

## Error Handling

The tool includes comprehensive error handling for:

- **Pre-flight permission checking**: Validates all URLs before processing begins
- Invalid Google Drive URLs
- Network connection issues
- Unsupported file formats
- File access permissions
- Disk space issues
- **Single file input**: When only one URL is provided, the tool will display an informational message and exit without processing (no merging needed)

### Permission Validation

Before downloading any files, the tool performs a pre-flight check on all provided URLs to ensure they are accessible. If any URL fails the permission check, **no processing occurs** and you'll receive a detailed report of which URLs need attention.

## Troubleshooting

### "Invalid Google Drive URL" Error

- Ensure the URL is from Google Drive
- Verify the file is shared publicly
- Check that the URL contains a valid file ID

### "Failed to download file" Error

- Check your internet connection
- Verify the Google Drive file is accessible
- Ensure the file hasn't been deleted or moved

### "Unsupported file type" Error

- Only PDF and common image formats are supported
- Check that the file isn't corrupted
- Verify the file has the correct extension

### Permission Issues

- Ensure you have write permissions in the output directory
- Check that the output file isn't already open in another application

## Development

To modify or extend the tool:

1. The main logic is in `index.js`
2. Key functions:
   - `extractFileId()`: Extracts file ID from Google Drive URLs
   - `downloadFile()`: Downloads files from URLs
   - `getFileType()`: Determines file type from content
   - `imageToPdf()`: Converts images to PDF format
   - `mergePdfs()`: Merges multiple PDFs into one

## License

MIT License - feel free to use and modify as needed.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
