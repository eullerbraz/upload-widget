import { CanceledError } from 'axios';
import { enableMapSet } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { uploadFileToStorage } from '../http/upload-file-to-storage';

export type Upload = {
  name: string;
  file: File;
  abortController: AbortController;
  status: 'progress' | 'success' | 'error' | 'canceled';
  originalSizeInBytes: number;
  uploadSizeInBytes: number;
};

type UploadState = {
  uploads: Map<string, Upload>;
  addUploads: (files: File[]) => void;
};

type UploadActions = {
  addUploads: (files: File[]) => void;
  cancelUpload: (uploadId: string) => void;
};

enableMapSet();

export const useUploads = create<UploadState & UploadActions>()(
  immer((set, get) => {
    async function processUpload(uploadId: string) {
      const upload = get().uploads.get(uploadId);

      if (!upload) return;

      try {
        await uploadFileToStorage(
          {
            file: upload.file,
            onProgress(sizeInBytes) {
              set((state) => {
                state.uploads.set(uploadId, {
                  ...upload,
                  uploadSizeInBytes: sizeInBytes,
                });
              });
            },
          },
          { signal: upload.abortController.signal }
        );

        set((state) => {
          state.uploads.set(uploadId, { ...upload, status: 'success' });
        });
      } catch (error) {
        if (error instanceof CanceledError) {
          return set((state) => {
            state.uploads.set(uploadId, { ...upload, status: 'canceled' });
          });
        }

        set((state) => {
          state.uploads.set(uploadId, { ...upload, status: 'error' });
        });
      }
    }

    async function cancelUpload(uploadId: string) {
      const upload = get().uploads.get(uploadId);

      if (!upload) return;

      upload.abortController.abort();
    }

    function addUploads(files: File[]) {
      for (const file of files) {
        const uploadId = crypto.randomUUID();
        const abortController = new AbortController();

        const upload: Upload = {
          name: file.name,
          file,
          status: 'progress',
          abortController,
          originalSizeInBytes: file.size,
          uploadSizeInBytes: 0,
        };

        set((state) => {
          state.uploads.set(uploadId, upload);
        });

        processUpload(uploadId);
      }
    }

    return { uploads: new Map(), addUploads, processUpload, cancelUpload };
  })
);
