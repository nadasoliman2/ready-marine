'use client';

import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import { Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { servicesApi } from '../../lib/api';
import ServiceCard from './ServiceCard';
import CardSlider from '../CardSlider';

export default function ServicesSection() {
  const { language, t } = useApp();
  const isAr = language === 'ar';
  const [services, setServices] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await servicesApi.getFeaturedServices(12);
        setServices(data.services || []);
      } catch {
        setServices([]);
      }
    };
    load();
  }, []);

  if (!services.length) return null;

  return (
    <section className="py-16 bg-gradient-to-b from-white to-red-50/40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
              <Sparkles size={14} />
              <span>{isAr ? 'مختارات مميزة' : 'Featured Picks'}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-marine-ink">{t.services || (isAr ? 'الخدمات' : 'Services')}</h2>
            <p className="text-marine-outline mt-2 text-sm sm:text-base">
              {t.servicesSubtitle || (isAr ? 'أفضل مزودي الخدمة في متناول يدك مع تواصل مباشر.' : 'Discover trusted service providers with instant contact actions.')}
            </p>
          </div>
          <Link
            href="/services"
            className="flex items-center gap-1.5 text-marine-primary hover:text-red-600 font-semibold text-sm transition-colors group"
          >
            {t.viewAll || 'View All'}
            <span className="group-hover:translate-x-0.5 transition-transform rtl:-translate-x-0.5">→</span>
          </Link>
        </div>

        <CardSlider isAr={isAr}>
          {services.map(service => (
            <ServiceCard key={service._id} service={service} compact />
          ))}
        </CardSlider>
      </div>
    </section>
  );
}
