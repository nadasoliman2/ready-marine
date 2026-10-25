'use client';

import { useState, useRef } from 'react';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function ImageUploader({ images = [], onChange }) {
  const { t, language } = useApp();
  const isAr = language === 'ar';
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('images', file));

      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server says WHICH file and WHY — too large, wrong type, not really an
        // image. Replacing that with "upload failed" left people re-trying the same
        // file with nothing to act on.
        throw new Error(data.message || 'Upload failed');
      }
      
      // Merge with existing images
      const newImages = [...images, ...data.images.map(img => ({
        url: img.url,
        is_primary: images.length === 0 && data.images[0].url === img.url
      }))];
      
      // Ensure at least one primary image exists
      if (newImages.length > 0 && !newImages.some(img => img.is_primary)) {
        newImages[0].is_primary = true;
      }

      onChange(newImages);

      if (data.rejected?.length) {
        alert(isAr
          ? `اترفعت الصور ما عدا: ${data.rejected.join('، ')} — الملفات دي مش صور صالحة.`
          : `Uploaded, except: ${data.rejected.join(', ')} — those are not valid image files.`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert(err.message || (isAr ? 'تعذر رفع الصور.' : 'Failed to upload images.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = (index) => {
    const newImages = [...images];
    const removedWasPrimary = newImages[index].is_primary;
    newImages.splice(index, 1);
    
    if (removedWasPrimary && newImages.length > 0) {
      newImages[0].is_primary = true;
    }
    onChange(newImages);
  };

  const setPrimary = (index) => {
    const newImages = images.map((img, i) => ({
      ...img,
      is_primary: i === index
    }));
    onChange(newImages);
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <div 
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`w-full border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-all group ${
          uploading 
            ? 'bg-zinc-50 border-zinc-200 cursor-not-allowed' 
            : 'border-zinc-300 dark:border-white/10 cursor-pointer bg-white dark:bg-[#09090b] hover:border-marine-cyan hover:bg-red-50 dark:hover:bg-marine-cyan/5'
        }`}
      >
        <input 
          type="file" 
          multiple 
          accept="image/*" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileChange}
          disabled={uploading}
        />
        
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-transform ${uploading ? 'bg-red-100 text-marine-primary' : 'bg-zinc-100 dark:bg-white/5 text-zinc-400 group-hover:scale-110 group-hover:bg-marine-cyan group-hover:text-white'}`}>
          {uploading ? <Loader2 size={28} className="animate-spin" /> : <Upload size={28} />}
        </div>
        
        <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-1">
          {uploading ? (t.uploading || 'Uploading...') : (t.clickToUpload || 'Click or drag images to upload')}
        </h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t.uploadLimitDesc || 'JPEG, PNG, WEBP up to 5MB each'}
        </p>
      </div>

      {/* Catalog Preview */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {images.map((img, index) => (
            <div key={`${img.url}-${index}`} className="relative group aspect-square rounded-xl overflow-hidden border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#09090b] shadow-sm">
              <img 
                src={img.url} 
                alt={isAr ? `صورة المنتج ${index + 1}` : `Product image ${index + 1}`}
                className="w-full h-full object-cover transition-transform group-hover:scale-110" 
              />
              
              {/* Overlay Actions */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                {!img.is_primary && (
                  <button 
                    type="button" 
                    onClick={(e) => { e.stopPropagation(); setPrimary(index); }}
                    className="bg-white text-zinc-900 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-marine-cyan hover:text-white transition-colors"
                  >
                    {t.setAsPrimary || 'Set as Primary'}
                  </button>
                )}
                <button 
                  type="button" 
                  onClick={(e) => { e.stopPropagation(); handleRemove(index); }}
                  className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition-colors shadow-lg"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Status Badge */}
              {img.is_primary && (
                <div className="absolute top-2 left-2 bg-marine-cyan text-white text-[8px] font-black px-2 py-0.5 rounded shadow-sm tracking-widest uppercase">
                  {t.primary || 'PRIMARY'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && !uploading && (
        <div className="flex flex-col items-center justify-center py-12 text-zinc-300 dark:text-zinc-700 border border-dashed border-zinc-200 dark:border-white/5 rounded-2xl">
          <ImageIcon size={48} className="opacity-20 mb-3" />
          <p className="text-xs font-bold uppercase tracking-widest">{t.noImagesSelected || 'No images selected'}</p>
        </div>
      )}
    </div>
  );
}
