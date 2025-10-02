#!/usr/bin/env node

const { program } = require("commander");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");

// Function to parse URLs from a string with multiple separators
function parseUrls(input) {
  // Split by various separators: newlines, commas with optional spaces, or multiple spaces
  const urls = input
    .split(/[\n,]|\s{2,}/)
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

// Main function to process files
async function processFiles(urls, outputPath) {
  const tempDir = path.join(__dirname, "temp");
  await fs.ensureDir(tempDir);

  const pdfBuffers = [];

  try {
    console.log(`📥 Processing ${urls.length} files...`);

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
  .version("1.0.0")
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

    await processFiles(urls, outputPath);
  });

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

program.parse();
