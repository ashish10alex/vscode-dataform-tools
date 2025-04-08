import FeatureReels from "@/components/feature-reels";

export default function FeaturesPage() {
  return (
    <div className="container py-8 md:py-12">
      <div className="mx-auto max-w-4xl text-center mb-12">
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          Powerful Features for Dataform Development
        </h1>
        <p className="text-lg text-muted-foreground">
          Everything you need to build and maintain your data transformations efficiently
        </p>
      </div>
      
      <FeatureReels />
    </div>
  );
} 