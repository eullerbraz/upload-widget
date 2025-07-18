import { CanceledError } from 'axios';
import { enableMapSet } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';
import { uploadFileToStorage } from '../http/upload-file-to-storage';
import { compressImage } from '../utils/compress-image';

export type Upload = {
  name: string;
  file: File;
  abortController?: AbortController;
  status: 'progress' | 'success' | 'error' | 'canceled';
  originalSizeInBytes: number;
  uploadSizeInBytes: number;
  compressedSizeInBytes?: number;
  remoteUrl?: string;
};

type UploadState = {
  uploads: Map<string, Upload>;
  addUploads: (files: File[]) => void;
};

type UploadActions = {
  addUploads: (files: File[]) => void;
  cancelUpload: (uploadId: string) => void;
  retryUpload: (uploadId: string) => void;
};

enableMapSet();

export const useUploads = create<UploadState & UploadActions>()(
  immer((set, get) => {
    async function updateUpload(uploadId: string, data: Partial<Upload>) {
      const upload = get().uploads.get(uploadId);

      if (!upload) return;

      set((state) => {
        state.uploads.set(uploadId, { ...upload, ...data });
      });
    }

    async function processUpload(uploadId: string) {
      const upload = get().uploads.get(uploadId);

      if (!upload) return;

      const abortController = new AbortController();

      updateUpload(uploadId, {
        uploadSizeInBytes: 0,
        remoteUrl: undefined,
        compressedSizeInBytes: undefined,
        abortController,
        status: 'progress',
      });

      try {
        const compressedFile = await compressImage({
          file: upload.file,
          maxWidth: 1000,
          maxHeight: 1000,
          quality: 0.8,
        });

        updateUpload(uploadId, { compressedSizeInBytes: compressedFile.size });

        const { url } = await uploadFileToStorage(
          {
            file: compressedFile,
            onProgress(sizeInBytes) {
              updateUpload(uploadId, {
                uploadSizeInBytes: sizeInBytes,
              });
            },
          },
          { signal: abortController.signal }
        );

        updateUpload(uploadId, { status: 'success', remoteUrl: url });
      } catch (error) {
        if (error instanceof CanceledError) {
          return updateUpload(uploadId, { status: 'canceled' });
        }

        updateUpload(uploadId, { status: 'error' });
      }
    }

    async function cancelUpload(uploadId: string) {
      const upload = get().uploads.get(uploadId);

      if (!upload) return;

      upload.abortController?.abort();
    }

    async function retryUpload(uploadId: string) {
      processUpload(uploadId);
    }

    function addUploads(files: File[]) {
      for (const file of files) {
        const uploadId = crypto.randomUUID();

        const upload: Upload = {
          name: file.name,
          file,
          status: 'progress',
          originalSizeInBytes: file.size,
          uploadSizeInBytes: 0,
        };

        set((state) => {
          state.uploads.set(uploadId, upload);
        });

        processUpload(uploadId);
      }
    }

    return {
      uploads: new Map(),
      addUploads,
      processUpload,
      retryUpload,
      cancelUpload,
    };
  })
);

export const usePendingUploads = () => {
  return useUploads(
    useShallow((store) => {
      const uploads = Array.from(store.uploads.values());

      const isThereAnyPendingUploads = uploads.some(
        (upload) => upload.status === 'progress'
      );

      if (!isThereAnyPendingUploads) {
        return { isThereAnyPendingUploads, globalPercentage: 100 };
      }

      const { total, uploaded } = uploads.reduce(
        (acc, upload) => {
          if (upload.compressedSizeInBytes) {
            acc.uploaded += upload.uploadSizeInBytes;
          }

          acc.total +=
            upload.compressedSizeInBytes || upload.originalSizeInBytes;

          return acc;
        },
        { total: 0, uploaded: 0 }
      );

      const globalPercentage = Math.min(
        Math.round((uploaded * 100) / total),
        100
      );

      return { isThereAnyPendingUploads, globalPercentage };
    })
  );
};
