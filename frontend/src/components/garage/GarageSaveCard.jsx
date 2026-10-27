'use client';

import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import { ArrowRight, Car, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { userApi } from '../../lib/api';
import { stripLocale } from '../../lib/locale';
import useGarageCars from '../company/useGarageCars';

/* A guest who pressed "Save it" signs up first; the car waits here and goes into their
   garage when they come back to the results signed in. */
const PENDING_GARAGE_KEY = 'readymarine_pending_garage_car';
const PENDING_GARAGE_TTL = 24 * 60 * 60 * 1000;

const readPendingCar = () => {
  try {
    const car = JSON.parse(window.localStorage.getItem(PENDING_GARAGE_KEY) || 'null');
    return car && Date.now() - Number(car.saved_at || 0) < PENDING_GARAGE_TTL ? car : null;
  } catch (_) {
    return null;
  }
};
const writePendingCar = (car) => {
  try { window.localStorage.setItem(PENDING_GARAGE_KEY, JSON.stringify({ ...car, saved_at: Date.now() })); } catch (_) { /* storage off: they add it in the garage */ }
};
const clearPendingCar = () => {
  try { window.localStorage.removeItem(PENDING_GARAGE_KEY); } catch (_) { /* nothing to clear */ }
};

const sameCar = (a, b) => String(a.car_model_id) === String(b.car_model_id) && Number(a.year) === Number(b.year);
const carName = (car) => [car.year, car.car_brand_name, car.car_model_name].filter(Boolean).join(' ');

/** One slim row: what saving the car gives, and the action — a link, or a button. */
function PromptRow({ title, sub, cta, href, onClick, busy = false, onNavigate }) {
  const className = 'w-full text-start flex items-center gap-3 rounded-lg border border-marine-cyan/25 bg-red-50/70 hover:bg-red-50 px-4 py-3 transition-colors disabled:opacity-60';
  const body = (
    <>
      <span className="shrink-0 w-8 h-8 rounded-xl bg-white text-marine-primary flex items-center justify-center shadow-sm">
        <Car size={16} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-marine-ink text-sm font-bold leading-snug">{title}</span>
        <span className="block text-marine-outline text-xs leading-snug mt-0.5">{sub}</span>
      </span>
      {/* On a phone only the arrow — the whole row is the action. */}
      <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-marine-primary">
        <span className="hidden sm:inline">{cta}</span>
        <ArrowRight size={15} className="rtl:rotate-180" />
      </span>
    </>
  );
  return href
    ? <Link href={href} onClick={onNavigate} aria-label={cta} className={className}>{body}</Link>
    : <button type="button" onClick={onClick} disabled={busy} aria-label={cta} className={className}>{body}</button>;
}

/**
 * "Save your car" above the search results, where the visitor has just seen what fits it.
 * Kept off the home page's search box so that one has a single job.
 *
 * `car` is the car the results are filtered by — make, model and year, with names — or null.
 * With a car not yet in the garage it names it ("Save 2018 Toyota Corolla to your garage"):
 * a customer saves it in one tap; a guest signs up and comes back to these results, where it
 * is saved for them. Without one, a guest or a customer with an empty garage gets the
 * general line. Nothing for staff accounts, or once the garage has the car.
 */
export default function GarageSaveCard({ car }) {
  const { user, isMounted, login, language } = useApp();
  const isAr = language === 'ar';
  const garageCars = useGarageCars();
  const [notice, setNotice] = useState(null); // { ok: boolean, text }
  const [saving, setSaving] = useState(false);
  // Where the guest comes back to after signing up: these very results.
  const [here, setHere] = useState('/products');

  useEffect(() => { setHere(`${stripLocale(window.location.pathname)}${window.location.search}`); }, [car?.car_model_id, car?.year]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const saveCar = async (toSave) => {
    setSaving(true);
    try {
      const res = await userApi.addCar(toSave);
      login({ ...user, cars: res.cars });
      setNotice({ ok: true, text: isAr ? `اتحفظت ${carName(toSave)} في جراجك` : `${carName(toSave)} is saved to your garage` });
    } catch (err) {
      setNotice({
        ok: false,
        text: /maximum/i.test(err.message || '')
          ? (isAr ? 'جراجك فيه 5 عربيات بالفعل — امسح واحدة الأول من البروفايل.' : 'Your garage already has 5 cars — remove one in your profile first.')
          : (err.message || (isAr ? 'معرفناش نحفظ العربية.' : 'The car could not be saved.')),
      });
    } finally {
      setSaving(false);
    }
  };

  // Back here signed in after "Save it" sent a guest to sign up: the car goes in now.
  useEffect(() => {
    if (!isMounted || user?.role !== 'user') return;
    const pending = readPendingCar();
    if (!pending) return;
    clearPendingCar();
    if ((user.cars || []).some((c) => sameCar(c, pending))) return;
    saveCar(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, user?._id]);

  if (!isMounted || (user && user.role !== 'user')) return null;

  if (notice) {
    return (
      <p className={`flex items-center gap-2 rounded-lg px-4 py-3 mb-6 text-sm font-bold ${notice.ok ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-red-50 border border-marine-cyan/25 text-red-700'}`}>
        {notice.ok ? <Check size={16} className="shrink-0" /> : <Car size={16} className="shrink-0" />}
        {notice.text}
      </p>
    );
  }

  const inGarage = !!car && garageCars.some((c) => c.kind !== 'company' && sameCar(c, car));

  if (car && !inGarage) {
    return (
      <div className="mb-6">
        {user ? (
          <PromptRow
            title={isAr ? `احفظ ${carName(car)} في جراجك` : `Save ${carName(car)} to your garage`}
            sub={isAr ? 'بضغطة واحدة — وكل مرة تدوّر تختارها من جراجك.' : 'One tap — then pick it from your garage every time.'}
            cta={isAr ? 'احفظها' : 'Save it'}
            onClick={() => saveCar(car)}
            busy={saving}
          />
        ) : (
          <PromptRow
            title={isAr ? `احفظ ${carName(car)} في جراجك` : `Save ${carName(car)} to your garage`}
            sub={isAr ? 'سجّل حساب وهتتحفظ لوحدها — وكل مرة تدوّر تختارها بضغطة.' : "Sign up and it's saved for you — then pick it in a tap every time."}
            cta={isAr ? 'إنشاء حساب' : 'Sign up'}
            href={`/register?redirect=${encodeURIComponent(here)}`}
            onNavigate={() => writePendingCar(car)}
          />
        )}
      </div>
    );
  }

  if (!car && garageCars.length === 0) {
    return (
      <div className="mb-6">
        <PromptRow
          title={isAr ? 'سجّل سياراتك واكتشف القطع المتوافقة معها دائماً' : 'Save your cars and always find the parts that fit'}
          sub={isAr
            ? 'احفظ عربياتك في جراجك مرة واحدة، وكل مرة تدوّر هتختارها بضغطة وتشوف القطع اللي بتركب عليها.'
            : 'Add them to your garage once — then pick one in a tap every time you search.'}
          cta={user ? (isAr ? 'أضف سيارتك' : 'Add car') : (isAr ? 'إنشاء حساب' : 'Sign up')}
          href={user ? '/profile?tab=garage' : `/register?redirect=${encodeURIComponent('/profile?tab=garage')}`}
        />
      </div>
    );
  }

  return null;
}
