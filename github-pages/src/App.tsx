import NavBar from './components/NavBar';
import Hero from './components/Hero';
import ToolsStrip from './components/ToolsStrip';
import StatsBar from './components/StatsBar';
import LiveDemo from './components/LiveDemo/LiveDemo';
import FeatureSection from './components/FeatureSection';
import FeatureGrid from './components/FeatureGrid';
import Gallery from './components/Gallery';
import HowItWorks from './components/HowItWorks';
import Comparison from './components/Comparison';
import PrivacyBand from './components/PrivacyBand';
import DownloadSection from './components/DownloadSection';
import Changelog from './components/Changelog';
import FAQ from './components/FAQ';
import Community from './components/Community';
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
        {/* Replaces the VideoShowcase reel (kept in components/, now hidden). */}
        <LiveDemo />
        <div id="features">
          {featureSections.map((feature) => (
            <FeatureSection key={feature.id} feature={feature} />
          ))}
        </div>
        <FeatureGrid />
        <Gallery />
        <HowItWorks />
        <Comparison />
        <PrivacyBand />
        <DownloadSection />
        <Changelog />
        <FAQ />
        <Community />
      </main>
      <Footer />
    </>
  );
}
