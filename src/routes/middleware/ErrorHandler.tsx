import express from 'express';
import fs from 'fs';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { UploadedFile } from '../../lib/storage/types';
import { isLimitError } from '../../lib/misc/isLimitError';
import { isExpectedClientFault } from '../../lib/misc/isExpectedClientFault';
import { isEmptyPayload } from '../../lib/misc/isEmptyPayload';
import { preserveFilesForDebugging } from '../../lib/debug/preserveFilesForDebugging';
import { shouldShareFilesForDebugging } from './shouldShareFilesForDebugging';
import * as cheerio from 'cheerio';
import { HttpCodedError } from '../../lib/errors/HttpCodedError';
import {
  PythonExitError,
  toUploadErrorCode,
} from '../../lib/anki/buildPythonExitError';
import { toNotionUploadError } from '../../lib/notion/toNotionUploadError';
import type {
  UploadErrorBody,
  UploadErrorCode,
} from '../../types/UploadErrorBody';

const transporter = nodemailer.createTransport({
  sendmail: true,
  newline: 'unix',
  path: '/usr/sbin/sendmail',
});

function buildFileSnippets(uploadedFiles: UploadedFile[]): string {
  if (!uploadedFiles || uploadedFiles.length === 0) return '';
  const lines: string[] = ['\n--- Uploaded Files ---'];
  for (const file of uploadedFiles) {
    lines.push(
      `\nFile: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`
    );
    try {
      const snippet = fs.readFileSync(file.path).slice(0, 500).toString('utf8');
      lines.push(`Snippet:\n${snippet}`);
    } catch {
      lines.push('(could not read file)');
    }
  }
  return lines.join('\n');
}

function buildAttachments(uploadedFiles: UploadedFile[]) {
  if (!uploadedFiles || uploadedFiles.length === 0) return [];
  return uploadedFiles.map((file) => ({
    filename: file.originalname,
    path: file.path,
  }));
}

async function sendErrorEmail(error: Error, req: express.Request) {
  if (process.env.NODE_ENV !== 'production') return;
  if (!shouldShareFilesForDebugging(req.body)) return;

  const $ = cheerio.load(error.message);
  const plainTextMessage = $.root().text();
  const subject = `[ERROR] [2anki.net] - ${plainTextMessage}`;
  const uploadedFiles = req.files as UploadedFile[];

  const message = {
    from: process.env.ERROR_SENDER_EMAIL ?? 'noreply@zoe.2anki.net',
    to: process.env.ERROR_RECEIVER_EMAIL ?? 'alexander@alemayhu.com',
    subject,
    text: `
${error.stack}

Request path: ${req.path}
Method: ${req.method}
Query: ${JSON.stringify(req.query)}
Body: ${JSON.stringify(req.body)}
${buildFileSnippets(uploadedFiles)}`,
    attachments: buildAttachments(uploadedFiles),
  };

  try {
    await transporter.sendMail(message);
  } catch (emailErr) {
    console.error('Failed to send error email:', emailErr);
  }
}

export default async function ErrorHandler(
  res: express.Response,
  req: express.Request,
  err: Error
) {
  const uploadedFiles = req.files as UploadedFile[];
  const isLimit = isLimitError(err);
  const quietError = isLimit || isExpectedClientFault(err);

  if (!quietError) {
    console.info('Send error');
    console.error(err);
    const canShareFiles = shouldShareFilesForDebugging(req.body);
    if (canShareFiles && !isEmptyPayload(uploadedFiles)) {
      preserveFilesForDebugging(req, uploadedFiles, err);
    }

    try {
      await sendErrorEmail(err, req);
    } catch (emailErr) {
      console.error('Failed to send error email:', emailErr);
    }
  } else if (isLimit) {
    console.info('User no limit reached');
  }

  if (res.headersSent) {
    console.info('Skipping error response: headers already sent');
    return;
  }

  if (err instanceof HttpCodedError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }

  if (err instanceof multer.MulterError) {
    const multerBody = toMulterErrorBody(err);
    res
      .status(multerBody.status)
      .json({ code: multerBody.code, message: multerBody.message });
    return;
  }

  const notionError = toNotionUploadError(err);
  if (notionError) {
    res.status(notionError.status).json(notionError.body);
    return;
  }

  if (!quietError && isInternalFault(err)) {
    const body: UploadErrorBody = {
      code: 'unknown',
      message:
        'Something broke on our end. Try again — if it keeps failing, email support@2anki.net.',
    };
    res.status(500).json(body);
    return;
  }

  const code: UploadErrorCode =
    err instanceof PythonExitError ? toUploadErrorCode(err.kind) : 'unknown';
  const body: UploadErrorBody = { code, message: err.message };
  res.status(400).json(body);
}

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

/**
 * Native JS error classes and database faults are never intentional
 * user-facing messages — surfacing err.message for these leaks internals
 * (CWE-209) and mislabels a server bug as a client fault. Deliberate throws
 * (limit errors, upload-shape errors) are plain Error and keep the 400 path.
 */
function isInternalFault(err: Error): boolean {
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError
  ) {
    return true;
  }
  if (err.message.startsWith('Knex:') || err.name === 'KnexTimeoutError') {
    return true;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && SQLSTATE_RE.test(code);
}

function toMulterErrorBody(err: multer.MulterError): {
  status: number;
  code: UploadErrorCode;
  message: string;
} {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return {
      status: 413,
      code: 'too_large',
      message:
        'Upload failed — file is over the 100 MB limit. Try splitting it.',
    };
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      status: 415,
      code: 'unsupported_format',
      message:
        "This file type isn't supported. Use .zip, .html, .md, .csv, or .apkg.",
    };
  }
  if (err.code === 'LIMIT_FIELD_VALUE') {
    return {
      status: 413,
      code: 'too_large',
      message: 'Message is too long — shorten it and try again.',
    };
  }
  return { status: 400, code: 'unknown', message: err.message };
}
