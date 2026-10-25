'use client';

import { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import useMyCompany from './useMyCompany';

/** The company car the manager is shopping for, so checkout can pick it for them. */
export const COMPANY_CAR_KEY = 'readycar_company_car';

/**
 * The cars a customer can shop for: their own garage, and — for someone who manages a
 * company account — the company's cars. Both have the garage's shape (car_brand_id,
 * car_model_id, year and the names); a company car also carries `kind: 'company'`,
 * its company and its plate.
 */
export default function useGarageCars() {
    const { user, isMounted } = useApp();
    const { memberships } = useMyCompany();
    const signedIn = isMounted && user?.role === 'user';
    const ownCars = signedIn ? user.cars : null;
    return useMemo(() => {
        if (!signedIn) return [];
        const own = (ownCars || []).map((car) => ({ ...car, kind: 'personal' }));
        const company = (memberships || [])
            .filter((m) => m.is_manager)
            .flatMap((m) => (m.cars || []).map((car) => ({
                ...car,
                kind: 'company',
                company_id: m.company._id,
                company_name: m.company.name,
            })));
        return [...own, ...company];
    }, [signedIn, ownCars, memberships]);
}

export const garageCarLabel = (car, isAr) => {
    const name = [car.year, car.car_brand_name, car.car_model_name].filter(Boolean).join(' ');
    if (car.kind !== 'company') return name;
    return `${name} — ${car.plate} (${isAr ? 'عربية' : 'car of'} ${car.company_name})`;
};

/**
 * Remember (or forget) the company car being shopped for. Picking a personal car, or
 * none, forgets it.
 */
export const rememberCompanyCar = (car) => {
    try {
        if (car?.kind === 'company') {
            window.localStorage.setItem(COMPANY_CAR_KEY, JSON.stringify({ company_id: car.company_id, car_id: car._id }));
        } else {
            window.localStorage.removeItem(COMPANY_CAR_KEY);
        }
    } catch (_) {
        // Storage off: checkout simply does not pre-pick the car.
    }
};

export const readRememberedCompanyCar = () => {
    try {
        const raw = window.localStorage.getItem(COMPANY_CAR_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
};
