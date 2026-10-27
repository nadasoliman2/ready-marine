import ServiceBannerAdSlider from '../components/services/ServiceBannerAdSlider';
import MostSoldProducts from '../components/MostSoldProducts';
import PromotedProducts from '../components/PromotedProducts';
import SpecialOffers from '../components/SpecialOffers';
import Bundles from '../components/Bundles';
import NewlyArrivedProducts from '../components/NewlyArrivedProducts';
import VendorsSlider from '../components/VendorsSlider';
import ServicesSection from '../components/services/ServicesSection';
import PartnersSection from '../components/PartnersSection';
import CorporateClientsSection from '../components/CorporateClientsSection';
import {
  AnnouncementBar, MarineHero, CoreCategories, ServiceSpotlight, WorkshopPartners, AuthorizedBrands, PaymentPartners,
} from '../components/marine/HomeSections';
import FeaturedHubs from '../components/marine/MarineHubsSection';

export default function Home() {
  return (
    <>
      <AnnouncementBar />
      {/* The hero carries the "select your vessel" form (useCarFinder), so the old
          finder popup is not offered on top of it. */}
      <MarineHero />
      {/* The 3 dynamic lifestyle slider cards — all 8 marketing segments unified here */}
      <FeaturedHubs />
      <CoreCategories />
      <ServiceSpotlight />
      <ServiceBannerAdSlider />
      <MostSoldProducts />
      <PromotedProducts />
      <Bundles />
      <SpecialOffers />
      <NewlyArrivedProducts />
      <ServicesSection />
      <WorkshopPartners />
      <PartnersSection />
      <CorporateClientsSection />
      <AuthorizedBrands />
      <VendorsSlider />
  
    </>
  );
}
