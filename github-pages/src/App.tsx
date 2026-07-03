import NavBar from './components/NavBar';
import Hero from './components/Hero';
import ToolsStrip from './components/ToolsStrip';
import StatsBar from './components/StatsBar';
import VideoShowcase from './components/VideoShowcase';
import FeatureSection from './components/FeatureSection';
import FeatureGrid from './components/FeatureGrid';
import HowItWorks from './components/HowItWorks';
import PrivacyBand from './components/PrivacyBand';
import DownloadSection from './components/DownloadSection';
import FAQ from './components/FAQ';
import Footer from './components/Footer';
import { featureSections } from './data/features';

export default function App() {
  return (
    <>
      <NavBar />
      <main>
        <Hero />
        <ToolsStrip />
        <StatsBar />
        <VideoShowcase />
        <div id="features">
          {featureSections.map((feature) => (
            <FeatureSection key={feature.id} feature={feature} />
          ))}
        </div>
        <FeatureGrid />
        <HowItWorks />
        <PrivacyBand />
        <DownloadSection />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
