#!/usr/bin/env node

const { program } = require("commander");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");
const readline = require("readline");

// Function to parse URLs from a string with multiple separators and extract URLs from mixed text
function parseUrls(input) {
  // First split by various separators: newlines, commas with optional spaces, or single/multiple spaces
  const tokens = input
    .split(/[\n,]|\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  // Filter to only keep valid Google Drive URLs
  const urls = tokens.filter((token) => {
    // Check if token looks like a Google Drive URL
    return (
      token.includes("drive.google.com") &&
      (token.includes("/file/d/") || token.includes("id="))
    );
  });

  return urls;
}

// Function to extract file ID from Google Drive URL
function extractFileId(url) {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
    /\/d\/([a-zA-Z0-9-_]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  throw new Error(`Invalid Google Drive URL: ${url}`);
}

// Function to get direct download URL from Google Drive file ID
function getDirectDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

// Function to download file from URL
async function downloadFile(url, outputPath) {
  try {
    const response = await axios({
      method: "get",
      url: url,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

// Function to determine file type based on content
async function getFileType(filePath) {
  try {
    const buffer = await fs.readFile(filePath);

    // Check for PDF signature
    if (buffer.slice(0, 4).toString() === "%PDF") {
      return "pdf";
    }

    // Check for common image signatures
    const signatures = {
      png: [0x89, 0x50, 0x4e, 0x47],
      jpg: [0xff, 0xd8, 0xff],
      jpeg: [0xff, 0xd8, 0xff],
      gif: [0x47, 0x49, 0x46],
      bmp: [0x42, 0x4d],
      webp: [0x52, 0x49, 0x46, 0x46],
      heic: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], // HEIC signature (first 12 bytes)
    };

    for (const [type, signature] of Object.entries(signatures)) {
      if (type === 'heic') {
        // HEIC has a longer signature, check first 12 bytes
        if (signature.every((byte, index) => buffer[index] === byte)) {
          return "image";
        }
      } else {
        if (signature.every((byte, index) => buffer[index] === byte)) {
          return "image";
        }
      }
    }

    // Additional check for HEIC files (alternative signature)
    const heicAlt = buffer.slice(4, 12).toString();
    if (heicAlt === 'ftypheic' || heicAlt === 'ftypmif1') {
      return "image";
    }

    throw new Error("Unsupported file type");
  } catch (error) {
    throw new Error(`Failed to determine file type: ${error.message}`);
  }
}

// Function to convert image to PDF
async function imageToPdf(imagePath) {
  try {
    // First, try to read the image and get metadata to check if it's supported
    let sharpInstance = sharp(imagePath);
    
    try {
      const metadata = await sharpInstance.metadata();
      console.log(`   📏 Image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
    } catch (metadataError) {
      console.log(`   ⚠️  Warning: Could not read metadata: ${metadataError.message}`);
    }

    // Process image with Sharp, applying auto-rotation based on EXIF data
    // Sharp automatically handles HEIC files when properly configured
    const processedImageBuffer = await sharpInstance
      .rotate() // Auto-rotate based on EXIF orientation
      .jpeg({ quality: 90 }) // Convert to JPEG for PDF embedding
      .toBuffer();

    // Get the dimensions of the processed image
    const finalMetadata = await sharp(processedImageBuffer).metadata();
    const imageWidth = finalMetadata.width;
    const imageHeight = finalMetadata.height;

    const pdfDoc = await PDFDocument.create();
    const image = await pdfDoc.embedJpg(processedImageBuffer);

    // Create page with correct dimensions
    const page = pdfDoc.addPage([imageWidth, imageHeight]);

    // Draw image to fill the entire page
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
    });

    return await pdfDoc.save();
  } catch (error) {
    // Provide more specific error information
    if (error.message.includes('heif') || error.message.includes('HEIF')) {
      throw new Error(`HEIC/HEIF processing failed: ${error.message}. This may be due to unsupported HEIC codec or Sharp configuration.`);
    }
    throw new Error(`Failed to convert image to PDF: ${error.message}`);
  }
}

// Function to merge PDFs
async function mergePdfs(pdfBuffers, outputPath) {
  try {
    const mergedPdf = await PDFDocument.create();

    for (const pdfBuffer of pdfBuffers) {
      const pdf = await PDFDocument.load(pdfBuffer);
      const pageIndices = pdf.getPageIndices();

      const pages = await mergedPdf.copyPages(pdf, pageIndices);
      pages.forEach((page) => mergedPdf.addPage(page));
    }

    const pdfBytes = await mergedPdf.save();
    await fs.writeFile(outputPath, pdfBytes);

    console.log(`✅ Successfully merged PDF saved to: ${outputPath}`);
  } catch (error) {
    throw new Error(`Failed to merge PDFs: ${error.message}`);
  }
}

// Function to test if a URL is accessible
async function testUrlAccess(url, index) {
  try {
    const fileId = extractFileId(url);
    const downloadUrl = getDirectDownloadUrl(fileId);

    // Test with a small range request to check accessibility and get some content
    const response = await axios({
      method: "get",
      url: downloadUrl,
      timeout: 10000, // 10 second timeout
      headers: {
        Range: "bytes=0-1023", // Request first 1KB to test access
      },
      validateStatus: function (status) {
        // Accept 200 (full content) and 206 (partial content)
        return status === 200 || status === 206;
      },
    });

    // Check if we got actual file content (not an error page)
    const contentType = response.headers["content-type"] || "";
    const contentLength = response.headers["content-length"] || "0";

    // If it's HTML, it's likely an error page from Google Drive
    if (contentType.includes("text/html")) {
      return {
        success: false,
        url,
        index,
        error: "Permission denied or file not accessible",
      };
    }

    return { success: true, url, index, fileId };
  } catch (error) {
    return {
      success: false,
      url,
      index,
      error:
        error.response?.status === 403
          ? "Permission denied"
          : error.response?.status === 404
          ? "File not found"
          : error.code === "ENOTFOUND"
          ? "Network error"
          : error.code === "ECONNRESET"
          ? "Connection reset"
          : error.message || "Unknown error",
    };
  }
}

// Interactive mode function
async function runInteractiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Function to ask a question and return a promise
  const askQuestion = (question) => {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  };

  // Function to ask for multi-line input
  const askMultiLineQuestion = (question) => {
    return new Promise((resolve) => {
      console.log(question);
      console.log(
        "💡 Tip: Paste URLs (any format) and press Enter - non-URL text will be ignored"
      );

      let input = "";

      const onLine = (line) => {
        rl.removeListener("line", onLine);
        resolve(line.trim());
      };

      rl.on("line", onLine);
    });
  };

  console.log("🚀 PDF Merge CLI - Interactive Mode");
  console.log("=====================================");
  console.log(
    "Welcome! This tool will help you merge PDF files and images from Google Drive URLs."
  );
  console.log("Press Ctrl+C anytime to exit.\n");

  // Ensure output directory exists
  const outputDir = path.join(__dirname, "output");
  await fs.ensureDir(outputDir);

  while (true) {
    try {
      console.log("📋 Step 1: Provide Google Drive URLs");
      console.log("────────────────────────────────────");

      let urls = [];

      // Loop until we get valid URLs
      while (urls.length === 0) {
        const urlsInput = await askMultiLineQuestion(
          "🔗 Enter Google Drive URLs (publicly shared):"
        );

        if (!urlsInput.trim()) {
          console.log("⚠️  No input provided. Please try again.\n");
          continue;
        }

        // Parse URLs from input (extracts URLs from mixed text)
        urls = parseUrls(urlsInput);

        if (urls.length === 0) {
          console.log("⚠️  No valid Google Drive URLs found in your input.");
          console.log(
            "💡 Make sure URLs contain 'drive.google.com' and are publicly shared.\n"
          );
          continue;
        }

        if (urls.length === 1) {
          console.log("ℹ️  Only one URL found - no need to merge!");
          console.log(
            "💡 Tip: Provide multiple URLs to merge files together\n"
          );
          urls = []; // Reset to ask again
          continue;
        }

        console.log(`✅ Found ${urls.length} valid URLs to process`);

        // Show which URLs were extracted
        urls.forEach((url, index) => {
          console.log(`   ${index + 1}. ${url}`);
        });
        console.log();
      }

      console.log("📝 Step 2: Choose output filename");
      console.log("──────────────────────────────────");

      let outputName;
      let outputPath;

      // Loop until we get a valid filename that doesn't exist
      while (true) {
        outputName = await askQuestion(
          "📄 Enter output filename (without .pdf extension): "
        );

        if (!outputName.trim()) {
          console.log("⚠️  No filename provided. Please try again.\n");
          continue;
        }

        outputPath = path.join("output", `${outputName.trim()}.pdf`);

        // Check if file already exists
        if (await fs.pathExists(outputPath)) {
          console.log(
            `⚠️  File '${outputName.trim()}.pdf' already exists in output folder.`
          );
          console.log("💡 Please choose a different filename.\n");
          continue;
        }

        break; // Valid filename that doesn't exist
      }

      console.log(`\n🔄 Processing ${urls.length} files...`);
      console.log("═".repeat(50));

      // Process files (this will handle permission checking and merging)
      await processFiles(urls, outputPath);

      console.log("═".repeat(50));
      console.log("🎉 Success! Ready for next merge.\n");
    } catch (error) {
      console.log("═".repeat(50));
      console.log(`❌ Error occurred: ${error.message}`);

      // Check if it's a permission error - if so, ask for URLs again
      if (error.message.includes("Permission check failed")) {
        console.log(
          "💡 Please check the URLs and try again with different ones.\n"
        );
        continue; // Go back to asking for URLs
      } else {
        console.log(
          "💡 Please try again with different URLs or check the file permissions.\n"
        );
      }
    }
  }
}

// Main function to process files
async function processFiles(urls, outputPath) {
  const tempDir = path.join(__dirname, "temp");
  await fs.ensureDir(tempDir);

  try {
    console.log(`📥 Checking access to ${urls.length} files...`);

    // Test all URLs for accessibility first
    const accessTests = await Promise.all(
      urls.map((url, index) => testUrlAccess(url, index + 1))
    );

    // Check if any URLs failed
    const failedUrls = accessTests.filter((test) => !test.success);

    if (failedUrls.length > 0) {
      console.log(
        `\n❌ Access issues detected for ${failedUrls.length} file(s):`
      );
      failedUrls.forEach((failed) => {
        console.log(`   File ${failed.index}: ${failed.error}`);
        console.log(`   URL: ${failed.url}`);
      });

      console.log(`\n🔒 Permission Check Failed!`);
      console.log(`💡 Please check the following:`);
      console.log(`   • Ensure all Google Drive files are shared publicly`);
      console.log(`   • Verify "Anyone with the link can view" is enabled`);
      console.log(`   • Check that the URLs are correct and files exist`);
      console.log(`\n📋 Failed URLs to check:`);
      failedUrls.forEach((failed) => {
        console.log(`   ${failed.url}`);
      });

      throw new Error(
        "Permission check failed - please verify URL access and try again"
      );
    }

    console.log(`✅ All files accessible! Starting download and processing...`);

    const pdfBuffers = [];
    const failedFiles = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n🔗 Processing file ${i + 1}/${urls.length}: ${url}`);

      try {
        // Extract file ID and create download URL
        const fileId = extractFileId(url);
        const downloadUrl = getDirectDownloadUrl(fileId);

        // Download file to temp directory
        const tempFilePath = path.join(tempDir, `file_${i}_${fileId}`);
        console.log(`⬇️  Downloading...`);
        await downloadFile(downloadUrl, tempFilePath);

        // Determine file type and process accordingly
        const fileType = await getFileType(tempFilePath);
        console.log(`📄 File type detected: ${fileType}`);

        let pdfBuffer;
        if (fileType === "pdf") {
          pdfBuffer = await fs.readFile(tempFilePath);
        } else if (fileType === "image") {
          console.log(`🖼️  Converting image to PDF...`);
          pdfBuffer = await imageToPdf(tempFilePath);
        } else {
          throw new Error(`Unsupported file type: ${fileType}`);
        }

        pdfBuffers.push(pdfBuffer);

        // Clean up temp file
        await fs.remove(tempFilePath);
        console.log(`✅ File ${i + 1} processed successfully`);
      } catch (error) {
        console.log(`❌ File ${i + 1} failed: ${error.message}`);
        failedFiles.push({
          url: url,
          index: i + 1,
          error: error.message
        });
        
        // Clean up temp file if it exists
        try {
          const fileId = extractFileId(url);
          const tempFilePath = path.join(tempDir, `file_${i}_${fileId}`);
          await fs.remove(tempFilePath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
    }

    // Check if we have any successful files to merge
    if (pdfBuffers.length === 0) {
      console.log(`\n❌ No files were successfully processed.`);
      if (failedFiles.length > 0) {
        console.log(`\n📋 Failed files (${failedFiles.length}):`);
        failedFiles.forEach(failed => {
          console.log(`   File ${failed.index}: ${failed.error}`);
          console.log(`   URL: ${failed.url}`);
        });
      }
      throw new Error("All files failed to process - no PDF will be generated");
    }

    // Show summary if some files failed
    if (failedFiles.length > 0) {
      console.log(`\n⚠️  ${failedFiles.length} file(s) failed to process:`);
      failedFiles.forEach(failed => {
        console.log(`   File ${failed.index}: ${failed.error}`);
      });
      console.log(`\n✅ Continuing with ${pdfBuffers.length} successful file(s)...`);
    }

    // Merge all PDFs
    console.log(`\n🔗 Merging ${pdfBuffers.length} PDFs...`);
    await mergePdfs(pdfBuffers, outputPath);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  } finally {
    // Clean up temp directory
    await fs.remove(tempDir);
  }
}

// CLI setup
program
  .name("pdf-merge")
  .description(
    "Merge PDF files and images from Google Drive URLs into a single PDF"
  )
  .version("1.0.0");

// Interactive mode command
program
  .command("interactive")
  .alias("i")
  .description("Start interactive mode - guided PDF merging with prompts")
  .action(async () => {
    await runInteractiveMode();
  });

// Direct command mode (existing functionality)
program
  .argument(
    "<urls>",
    "Google Drive URLs (publicly shared) - can be space, newline, or comma separated"
  )
  .option("-o, --output <path>", "Output PDF file path", "output/merged.pdf")
  .option("-n, --name <filename>", "Output filename (without .pdf extension)")
  .action(async (urlsString, options) => {
    // Parse URLs from the input string
    const urls = parseUrls(urlsString);

    if (urls.length === 0) {
      console.error("❌ Error: Please provide at least one Google Drive URL");
      process.exit(1);
    }

    // Handle single URL case
    if (urls.length === 1) {
      console.log("🚀 PDF Merge CLI");
      console.log(`📋 Input URLs: ${urls.length}`);
      console.log("ℹ️  Only one file provided - no need to merge!");
      console.log("💡 Tip: Provide multiple URLs to merge files together");
      console.log(`🔗 Your URL: ${urls[0]}`);
      return;
    }

    // Ensure output directory exists
    const outputDir = path.join(__dirname, "output");
    await fs.ensureDir(outputDir);

    // Determine output file path
    let outputPath = options.output;
    if (options.name) {
      // If -n is provided, use it as filename with .pdf extension in output folder
      outputPath = path.join("output", `${options.name}.pdf`);
    }

    // Check if output file already exists (direct mode - return error)
    if (await fs.pathExists(outputPath)) {
      console.error(`❌ Error: Output file '${outputPath}' already exists`);
      console.error(
        "💡 Please choose a different filename or remove the existing file"
      );
      process.exit(1);
    }

    console.log("🚀 PDF Merge CLI");
    console.log(`📋 Input URLs: ${urls.length}`);
    console.log(`📄 Output file: ${outputPath}`);

    try {
      await processFiles(urls, outputPath);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

program.parse();
