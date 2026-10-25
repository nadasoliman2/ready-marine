'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Link2, Loader2, Upload, X } from 'lucide-react';
import { resolveAssetUrl } from '../../lib/assets';
import { useApp } from '../../context/AppContext';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}`;

/**
 * SingleImageUploader – compact single-image upload widget for admin pages
 * (categories, product-brands, car-brands).
 *
 * Props:
 *   value     string    – current image URL (stored in form)
 *   onChange  fn(url)   – called with the uploaded/pasted URL
 *   label     string    – optional field label
 */
export default function SingleImageUploader({ value, onChange, label }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [tab, setTab] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [localPreview, setLocalPreview] = useState('');
  const fileRef = useRef(null);

  const doUpload = async (file) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setUploadError(isAr ? 'يُسمح فقط بصور JPEG أو PNG أو WebP.' : 'Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(isAr ? 'يجب ألا يتجاوز حجم الملف 5 ميجابايت.' : 'File must be under 5 MB.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('images', file);
      const res = await fetch(`${BASE_URL}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      const url = data.images?.[0]?.url;
      if (!url) throw new Error(isAr ? 'لم يُرجع الخادم رابطاً للصورة.' : 'No image URL was returned by the server.');
      setLocalPreview('');
      onChange(url);
    } catch (err) {
      setLocalPreview('');
      setUploadError(isAr ? 'تعذر رفع الصورة. يرجى المحاولة مرة أخرى.' : err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setLocalPreview(URL.createObjectURL(file));
      setUploadError('');
      doUpload(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    doUpload(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="space-y-2">
      {label && (
        <span className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {label}
        </span>
      )}

      {/* Tab Toggle */}
      <div className="flex rounded-lg overflow-hidden border border-zinc-200 dark:border-white/10 text-xs font-bold w-fit">
        {[
          { id: 'upload', icon: Upload, text: isAr ? 'رفع' : 'Upload' },
          { id: 'url', icon: Link2, text: 'URL' },
        ].map(({ id, icon: Icon, text }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              tab === id
                ? 'bg-marine-cyan text-white'
                : 'bg-zinc-50 dark:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <Icon size={11} /> {text}
          </button>
        ))}
      </div>

      {/* Upload Zone */}
      {tab === 'upload' && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            disabled={uploading}
            className={`w-full border-2 border-dashed rounded-xl py-5 flex flex-col items-center gap-2 transition-colors focus:outline-none ${
              dragging
                ? 'border-marine-cyan bg-marine-cyan/5'
                : 'border-zinc-200 dark:border-white/10 hover:border-marine-cyan/40 bg-zinc-50 dark:bg-white/[0.02]'
            } ${uploading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {uploading
              ? <Loader2 size={20} className="animate-spin text-marine-primary" />
              : <ImageIcon size={20} className="text-zinc-300" />
            }
            <p className="text-xs font-semibold text-zinc-400">
              {uploading ? (isAr ? 'جاري الرفع…' : 'Uploading…') : (isAr ? 'انقر أو اسحب صورة' : 'Click or drag an image')}
            </p>
            <p className="text-[10px] text-zinc-300">{isAr ? 'JPEG · PNG · WebP · بحد أقصى 5 ميجابايت' : 'JPEG · PNG · WebP · max 5 MB'}</p>
          </button>
          {uploadError && (
            <p className="text-xs text-red-500 font-semibold">{uploadError}</p>
          )}
        </>
      )}

      {/* URL Input */}
      {tab === 'url' && (
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/image.jpg"
          className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan dark:text-white"
        />
      )}

      {/* Preview */}
      {(value || localPreview) && (
        <div className="relative w-full h-32 rounded-xl overflow-hidden border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
          <img
            src={localPreview || resolveAssetUrl(value)}
            alt={isAr ? 'معاينة الصورة' : 'Image preview'}
            className="w-full h-full object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <button
            type="button"
            onClick={() => { onChange(''); setLocalPreview(''); }}
            className="absolute top-1.5 end-1.5 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500/80 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
