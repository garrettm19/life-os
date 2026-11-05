import { beforeEach, describe, expect, jest, it } from '@jest/globals';
import * as Sharing from 'expo-sharing';
import { MAX_BACKUP_BYTES } from '../../domain/backup';
import { exportBackup } from '../export-backup';

// The device export: the backup goes to a temporary file in the cache, the share sheet offers it,
// and the file is deleted afterwards. The native modules are replaced; the content is synthetic.

type MockFile = { uri: string; exists: boolean; written: string | null; overwrite?: boolean };
const mockFiles: MockFile[] = [];

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    record: MockFile;
    constructor(dir: string, name: string) {
      this.record = { uri: `${dir}/${name}`, exists: false, written: null };
      mockFiles.push(this.record);
    }
    get uri() {
      return this.record.uri;
    }
    get exists() {
      return this.record.exists;
    }
    create(options?: { overwrite?: boolean }) {
      this.record.exists = true;
      this.record.overwrite = options?.overwrite;
    }
    write(content: string) {
      this.record.written = content;
    }
    delete() {
      this.record.exists = false;
    }
  },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const isAvailable = jest.mocked(Sharing.isAvailableAsync);
const share = jest.mocked(Sharing.shareAsync);
const RAW = JSON.stringify({ format: 'synthetic', items: ['Example walk'] });

beforeEach(() => {
  mockFiles.length = 0;
  isAvailable.mockReset().mockResolvedValue(true);
  share.mockReset().mockResolvedValue(undefined);
});

describe('exporting a backup on the device', () => {
  it('offers the file and is never confirmed, since a save and a cancel close the sheet alike', async () => {
    const result = await exportBackup(RAW);
    expect(result.confirmed).toBe(false);
    expect(result.notice).toMatch(/^Export sheet closed\./);
    expect(mockFiles).toHaveLength(1);
    const [file] = mockFiles;
    // A readable local date and time that still matches LifeOS-backup-*.json.
    expect(file.uri).toMatch(/^file:\/\/\/cache\/LifeOS-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(file.overwrite).toBe(true);
    expect(file.written).toBe(RAW);
    expect(share).toHaveBeenCalledWith(
      file.uri,
      expect.objectContaining({ mimeType: 'application/json', UTI: 'public.json' }),
    );
    // The temporary copy does not stay in the cache.
    expect(file.exists).toBe(false);
  });

  it('deletes the temporary file when the share sheet fails', async () => {
    share.mockRejectedValue(new Error('Synthetic share failure'));
    await expect(exportBackup(RAW)).rejects.toThrow('Synthetic share failure');
    expect(mockFiles).toHaveLength(1);
    expect(mockFiles[0].exists).toBe(false);
  });

  it('writes no file when sharing is unavailable or the backup is too large', async () => {
    isAvailable.mockResolvedValue(false);
    await expect(exportBackup(RAW)).rejects.toThrow('File export is not available on this device.');
    isAvailable.mockResolvedValue(true);
    await expect(exportBackup('x'.repeat(MAX_BACKUP_BYTES + 1))).rejects.toThrow(/under 20 MB/);
    expect(mockFiles).toHaveLength(0);
    expect(share).not.toHaveBeenCalled();
  });
});
