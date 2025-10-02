#!/usr/bin/env node

const { program } = require("commander");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");
const readline = require("readline");

// Function to parse URLs from a string with multiple separators
function parseUrls(input) {
  // Split by various separators: newlines, commas with optional spaces, or single/multiple spaces
  const urls = input
    .split(/[\n,]|\s+/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

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
    };

    for (const [type, signature] of Object.entries(signatures)) {
      if (signature.every((byte, index) => buffer[index] === byte)) {
        return "image";
      }
    }

    throw new Error("Unsupported file type");
  } catch (error) {
    throw new Error(`Failed to determine file type: ${error.message}`);
  }
}

// Function to convert image to PDF
async function imageToPdf(imagePath) {
  try {
    // Process image with Sharp, applying auto-rotation based on EXIF data
    const processedImageBuffer = await sharp(imagePath)
      .rotate() // Auto-rotate based on EXIF orientation
      .jpeg({ quality: 90 })
      .toBuffer();

    // Get the dimensions of the processed image
    const metadata = await sharp(processedImageBuffer).metadata();
    const imageWidth = metadata.width;
    const imageHeight = metadata.height;

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
      console.log("💡 Tip: You can paste multiple URLs separated by spaces, commas, or newlines");
      console.log("📝 Press Enter twice when done, or type 'done' on a new line:");
      
      let input = "";
      let emptyLineCount = 0;
      
      const onLine = (line) => {
        if (line.trim() === "done" || emptyLineCount >= 1) {
          rl.removeListener('line', onLine);
          resolve(input.trim());
          return;
        }
        
        if (line.trim() === "") {
          emptyLineCount++;
        } else {
          emptyLineCount = 0;
          input += line + "\n";
        }
      };
      
      rl.on('line', onLine);
    });
  };

  console.log("🚀 PDF Merge CLI - Interactive Mode");
  console.log("=====================================");
  console.log("Welcome! This tool will help you merge PDF files and images from Google Drive URLs.");
  console.log("Press Ctrl+C anytime to exit.\n");

  // Ensure output directory exists
  const outputDir = path.join(__dirname, "output");
  await fs.ensureDir(outputDir);

  while (true) {
    try {
      console.log("📋 Step 1: Provide Google Drive URLs");
      console.log("────────────────────────────────────");
      
      const urlsInput = await askMultiLineQuestion(
        "🔗 Enter Google Drive URLs (publicly shared):"
      );
      
      if (!urlsInput.trim()) {
        console.log("⚠️  No URLs provided. Please try again.\n");
        continue;
      }

      // Parse URLs
      const urls = parseUrls(urlsInput);
      
      if (urls.length === 0) {
        console.log("⚠️  No valid URLs found. Please try again.\n");
        continue;
      }

      if (urls.length === 1) {
        console.log("ℹ️  Only one URL provided - no need to merge!");
        console.log("💡 Tip: Provide multiple URLs to merge files together\n");
        continue;
      }

      console.log(`✅ Found ${urls.length} URLs to process\n`);

      console.log("📝 Step 2: Choose output filename");
      console.log("──────────────────────────────────");
      
      const outputName = await askQuestion(
        "📄 Enter output filename (without .pdf extension): "
      );
      
      if (!outputName.trim()) {
        console.log("⚠️  No filename provided. Please try again.\n");
        continue;
      }

      const outputPath = path.join("output", `${outputName.trim()}.pdf`);
      
      console.log(`\n🔄 Processing ${urls.length} files...`);
      console.log("═".repeat(50));

      // Process files (this will handle permission checking and merging)
      await processFiles(urls, outputPath);
      
      console.log("═".repeat(50));
      console.log("🎉 Success! Ready for next merge.\n");
      
    } catch (error) {
      console.log("═".repeat(50));
      console.log(`❌ Error occurred: ${error.message}`);
      console.log("💡 Please try again with different URLs or check the file permissions.\n");
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

      throw new Error("Permission check failed - please verify URL access and try again");
    }

    console.log(`✅ All files accessible! Starting download and processing...`);

    const pdfBuffers = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n🔗 Processing file ${i + 1}/${urls.length}: ${url}`);

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
