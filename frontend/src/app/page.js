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
import FeaturedHubs, { HubBanner } from '../components/marine/MarineHubsSection';

export default function Home() {
  return (
    <>
      <AnnouncementBar />
      {/* The hero carries the "select your vessel" form (useCarFinder), so the old
          finder popup is not offered on top of it. */}
      <MarineHero />
      {/* Three audience hubs before the main categories; the other five are banners
          spread between the product rows below. */}
      <FeaturedHubs />
      <CoreCategories />
      <ServiceSpotlight />
      <ServiceBannerAdSlider />
      <MostSoldProducts />
      <HubBanner slug="pro-angler" />
      <PromotedProducts />
      <Bundles />
      <HubBanner slug="next-gen" />
      <SpecialOffers />
      <NewlyArrivedProducts />
      <HubBanner slug="family-safety" />
      <ServicesSection />
      <WorkshopPartners />
      <HubBanner slug="saltwater-freshwater" />
      <PartnersSection />
      <CorporateClientsSection />
      <AuthorizedBrands />
      <HubBanner slug="diy-maintenance" />
      <VendorsSlider />
      <PaymentPartners />
    </>
  );
}
