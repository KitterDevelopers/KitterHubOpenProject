import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { OutlinedButton } from '../ui';
import client from '../api/client';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';
import ImageCropper from './ImageCropper';

// 图片上传：头像 / 稿件封面 / 个人主页背景图。上传成功后回调 onChange(url)。
//
// crop=true 时先弹裁剪器：适用于「展示区比例固定」的图（个人主页背景图），
// 否则用户传一张竖拍照片，主页横幅会按原图比例拉得很高。
export default function ImageUpload({ value, onChange, label, previewSize = 48, previewRatio = 1, crop = false }) {
  const inputRef = useRef(null);
  const { t } = useI18n();
  const err = useErr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null); // 等待裁剪的原始文件

  const post = async (blob, filename) => {
    const fd = new FormData();
    fd.append('file', blob, filename);
    const res = await client.post('/upload', fd);
    onChange(res.data.url);
  };

  const upload = async (blob, filename) => {
    setBusy(true);
    setError('');
    try {
      await post(blob, filename);
    } catch (ex) {
      setError(err(ex));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 清掉，否则同一个文件再选一次不触发 change
    if (!file) return;
    if (crop) {
      setError('');
      setPending(file);
      return;
    }
    upload(file, file.name);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        {value && (
          <img
            src={value}
            alt={t('upload.preview')}
            style={{ width: previewSize, height: Math.round(previewSize / previewRatio), borderRadius: 'var(--radius)', objectFit: 'cover', border: '1px solid var(--border-soft)', flexShrink: 0 }}
          />
        )}
        <OutlinedButton type="button" onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}>
          <span slot="icon"><ImagePlus size={16} /></span>
          {busy ? t('upload.uploading') : (label || t('upload.image'))}
        </OutlinedButton>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--md-sys-color-error)', marginTop: 4 }}>{error}</div>}

      {pending && (
        <ImageCropper
          file={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onDone={(blob, size) => {
            setPending(null);
            // 输出恒定是 JPEG（见 ImageCropper.toBlob），文件名给 .jpg 让后端认出来
            upload(blob, `crop_${size || 'image'}.jpg`);
          }}
        />
      )}
    </div>
  );
}
