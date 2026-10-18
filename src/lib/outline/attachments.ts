import { File } from "expo-file-system";
import { fetch } from "expo/fetch";

import type { RequestWithPolicies } from "./collections";

/** A file on the phone, e.g. from the photo picker. */
export interface LocalFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

interface CreatedAttachment {
  /** "post" (a form upload) unless the server is set to PUT straight to S3. */
  mode?: "post" | "put";
  uploadUrl?: string;
  form?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  attachment: { url: string };
}

/**
 * Uploads a file for a document, as Outline's editor does, and returns the
 * link to put in the document (/api/attachments.redirect?id=…). The upload
 * itself is authorized by a short-lived signature from attachments.create.
 */
export async function uploadAttachment(
  request: RequestWithPolicies,
  server: string,
  documentId: string,
  file: LocalFile,
): Promise<string> {
  // Expo's fetch sends a File's bytes; React Native's { uri, name, type }
  // form parts aren't supported by it.
  const contents = new File(file.uri);
  const { data } = await request<CreatedAttachment>("attachments.create", {
    name: file.name,
    documentId,
    size: file.size ?? contents.size,
    contentType: file.type,
    preset: "documentAttachment",
  });

  let response: Response;
  if (data.mode === "put" && data.url) {
    response = await fetch(data.url, { method: "PUT", headers: data.headers, body: contents });
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(data.form ?? {})) {
      form.append(key, value);
    }
    form.append("file", contents as unknown as Blob, file.name);
    const url = (data.uploadUrl ?? "").startsWith("/") ? `${server}${data.uploadUrl}` : (data.uploadUrl ?? "");
    response = await fetch(url, { method: "POST", body: form });
  }
  if (!response.ok) {
    throw new Error(`The upload was refused (HTTP ${response.status}).`);
  }
  return data.attachment.url;
}
