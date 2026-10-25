'use client';

import { useState } from 'react';
import { Mail, MapPin, Phone, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { contactApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';

const inputClass = 'w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/10';
const labelClass = 'block text-sm font-bold text-zinc-700 mb-2';

export default function ContactPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const contactEmail = siteSettings?.contact_email || '';
  const contactTelephone = siteSettings?.contact_telephone || '';
  const contactAddress = siteSettings?.contact_address || '';

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await contactApi.submitInquiry(formData);
      setSuccess(isAr ? 'تم استلام رسالتك بنجاح.' : 'Your message has been received.');
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر إرسال الرسالة.' : 'Could not send your message.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-50" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="bg-[#111315] text-white">
        <div className="max-w-7xl mx-auto px-4 py-12 md:py-16">
          <div className="max-w-2xl">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight">
              {isAr ? 'اتصل بنا' : 'Contact Us'}
            </h1>
            <p className="mt-3 text-zinc-300 text-sm md:text-base leading-relaxed">
              {isAr
                ? 'أرسل استفسارك وسنراجعه من لوحة الإدارة للرد عليك بأسرع وقت.'
                : 'Send your inquiry and our team will review it from the admin panel.'}
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-10 md:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.85fr] gap-8 items-start">
          <form onSubmit={handleSubmit} className="bg-white border border-zinc-200 rounded-xl shadow-sm p-5 md:p-7 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>{isAr ? 'اسمك' : 'Your name'}</label>
                <input
                  required
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder={isAr ? 'اكتب اسمك' : 'Enter your name'}
                />
              </div>
              <div>
                <label className={labelClass}>{isAr ? 'بريدك الإلكتروني' : 'Your Email'}</label>
                <input
                  required
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>{isAr ? 'الموضوع' : 'Subject'}</label>
              <input
                required
                name="subject"
                type="text"
                value={formData.subject}
                onChange={handleChange}
                className={inputClass}
                placeholder={isAr ? 'كيف يمكننا مساعدتك؟' : 'How can we help?'}
              />
            </div>

            <div>
              <label className={labelClass}>{isAr ? 'رسالتك (اختياري)' : 'Your message (optional)'}</label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows={6}
                className={`${inputClass} resize-none`}
                placeholder={isAr ? 'أضف أي تفاصيل مهمة' : 'Add any useful details'}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                {error}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                <CheckCircle2 size={17} />
                <span>{success}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full md:w-auto items-center justify-center gap-2 rounded-lg bg-marine-cyan px-6 py-3 text-sm font-black text-white transition hover:bg-marine-cyan-dark disabled:opacity-60"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {isAr ? 'إرسال' : 'Send Message'}
            </button>
          </form>

          <aside className="bg-white border border-zinc-200 rounded-xl shadow-sm p-5 md:p-7">
            <h2 className="text-xl font-black text-zinc-900">
              {isAr ? 'هل تحتاج مساعدة؟' : 'Need a Help?'}
            </h2>
            <div className="mt-6 space-y-5">
              <a href={contactEmail ? `mailto:${contactEmail}` : undefined} className="flex gap-3 text-zinc-700 hover:text-marine-primary transition-colors">
                <Mail size={20} className="text-marine-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold uppercase text-zinc-500">{isAr ? 'البريد الإلكتروني' : 'Email'}</p>
                  <p className="text-sm font-semibold break-all">{contactEmail || '-'}</p>
                </div>
              </a>
              <a href={contactTelephone ? `tel:${contactTelephone}` : undefined} className="flex gap-3 text-zinc-700 hover:text-marine-primary transition-colors">
                <Phone size={20} className="text-marine-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold uppercase text-zinc-500">{isAr ? 'الهاتف' : 'Telephone'}</p>
                  <p className="text-sm font-semibold" dir="ltr">{contactTelephone || '-'}</p>
                </div>
              </a>
              <div className="flex gap-3 text-zinc-700">
                <MapPin size={20} className="text-marine-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold uppercase text-zinc-500">{isAr ? 'العنوان' : 'Address'}</p>
                  <p className="text-sm font-semibold leading-relaxed">{contactAddress || '-'}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
