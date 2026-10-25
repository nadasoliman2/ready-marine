'use client';

import { useEffect, useRef, useState } from 'react';
import { useBrandModels } from '../../lib/carBrandModels';
import { useRouter } from '../../lib/navigation';
import useGarageCars, { rememberCompanyCar } from '../company/useGarageCars';

/**
 * The "find parts for your car" form, without its looks: the makes and product types, the
 * customer's garage, what is picked, and the search. The home page's hero and the welcome
 * popup draw it each their own way and behave the same.
 *
 * Filling in one field opens the next by itself: make → model → year → product type, then
 * the search button takes the keyboard (`openNext`, `searchButtonRef`). Opening any list by
 * hand drops what was queued (`dropQueued`).
 *
 * `withType: false` — a form without the product type field: the car is all it asks, and
 * the year hands the keyboard to the search button.
 */
export default function useCarFinder({ onSearch, withType = true } = {}) {
  const router = useRouter();
  const [metadata, setMetadata] = useState(null);
  const [filters, setFilters] = useState({ car_brand_id: '', car_model_id: '', car_year: '', garage_car_id: '', type_id: '' });
  const [openNext, setOpenNext] = useState(null); // 'model' | 'year' | 'type' | 'search' | null
  const searchButtonRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (active && data) setMetadata(data); })
      .catch((err) => console.error('Failed to fetch the car finder filters:', err));
    return () => { active = false; };
  }, []);

  const selectedBrand = metadata?.carBrands?.find(b => b._id === filters.car_brand_id);
  // The makes arrive without their models; this fetches the picked make's on its own.
  const brandModels = useBrandModels(selectedBrand);
  const selectedModel = brandModels.find(m => m._id === filters.car_model_id);
  // The garage, plus the company's cars for someone who manages a company account.
  const garageCars = useGarageCars();

  // After the car: the product type, unless one is already chosen or the form has none.
  const afterCar = () => {
    if (!withType) return 'search';
    return metadata?.productTypes?.length && !filters.type_id ? 'type' : null;
  };

  useEffect(() => {
    if (openNext !== 'search') return;
    searchButtonRef.current?.focus({ preventScroll: true });
    setOpenNext(null);
  }, [openNext]);

  const handleBrandChange = (val) => {
    setFilters(prev => ({ ...prev, garage_car_id: '', car_brand_id: val, car_model_id: '', car_year: '' }));
    setOpenNext(val ? 'model' : null);
  };

  const handleModelChange = (val) => {
    setFilters(prev => ({ ...prev, garage_car_id: '', car_model_id: val, car_year: '' }));
    const model = brandModels.find(m => m._id === val);
    setOpenNext(!val ? null : (model?.years?.length ? 'year' : afterCar()));
  };

  const handleYearChange = (val) => {
    setFilters(prev => ({ ...prev, garage_car_id: '', car_year: val }));
    setOpenNext(val ? afterCar() : null);
  };

  const handleTypeChange = (val) => {
    setFilters(prev => ({ ...prev, type_id: val }));
    setOpenNext(val ? 'search' : null);
  };

  const dropQueued = () => setOpenNext(null);

  const handleGarageCarChange = (carId) => {
    const car = garageCars.find(item => String(item._id) === String(carId));
    rememberCompanyCar(car);
    if (!car) {
      setFilters(prev => ({ ...prev, garage_car_id: '', car_brand_id: '', car_model_id: '', car_year: '' }));
      setOpenNext(null);
      return;
    }
    setOpenNext(afterCar());
    setFilters(prev => ({
      ...prev,
      garage_car_id: carId,
      car_brand_id: car.car_brand_id,
      car_model_id: car.car_model_id,
      car_year: car.year,
    }));
  };

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (filters.car_brand_id) params.set('car_brand_id', filters.car_brand_id);
    if (filters.car_model_id) params.set('car_model_id', filters.car_model_id);
    if (filters.car_year) params.set('car_year', filters.car_year);
    if (filters.garage_car_id) params.set('garage_car_id', filters.garage_car_id);
    if (filters.type_id) params.set('type_id', filters.type_id);
    onSearch?.();
    router.push(`/products?${params.toString()}`);
  };

  return {
    metadata, filters, garageCars, brandModels, selectedModel, openNext, searchButtonRef,
    handleBrandChange, handleModelChange, handleYearChange, handleTypeChange, handleGarageCarChange,
    dropQueued, handleSearch,
  };
}
