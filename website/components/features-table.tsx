"use client";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

interface FeatureItem {
  name: string;
  description: React.ReactNode;
  anchor: string;
  image?: string;
  imageDark?: string;
}

import { useTheme } from "next-themes";

export default function FeaturesTable() {
  const [selectedFeature, setSelectedFeature] = useState<string>("compilation");
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const features: FeatureItem[] = [
    {
      name: "Compiled Query & Dry run stats",
      description: "Compiled query with dry run stats in a vertical split",
      anchor: "compilation",
      image: "/compiled_query_preview_light.png",
      imageDark: "/compiled_query_preview_dark.png",
    },
    {
      name: "Inline diagnostics on `.sqlx` file 🚨",
      description: "Native LSP like experience with diagnostics being directly put on sqlx file",
      anchor: "diagnostics",
      image: "/diagnostics_light.png",
      imageDark: "/diagnostics_dark.png",
    },
    {
      name: "Dependency graph",
      description: "Interactive dependency graph with external sources highlighted in distinct colors",
      anchor: "depgraph",
      image: "/dependancy_tree_light.png",
      imageDark: "/dependancy_tree_dark.png",
    },
    {
      name: "Preview query results",
      description: "Preview query results in a table by running the file",
      anchor: "preview_query_results",
      image: "/preview_query_results_light.png",
      imageDark: "/preview_query_results_dark.png",
    },
    {
      name: "BigQuery hover definition provider",
      description: "Hover definition for tables, columns, column descriptions, types and common BigQuery functions",
      anchor: "hover",
      image: "/table_hover_light.png",
      imageDark: "/table_hover_dark.png",
    },
    {
      name: "Cost estimator",
      description: "Estimate the cost of running a Tag",
      anchor: "cost_estimator",
      image: "/tag_cost_estimator_light.png",
      imageDark: "/tag_cost_estimator_dark.png",
    },
    {
      name: "Go to definition",
      description: "Go to definition for source in `$ref{(\"my_source\")}` and javascript blocks in `.sqlx` files",
      anchor: "definition",
      image: "/go_to_definition.gif",
    },
    {
      name: "Auto-completion",
      description: "Completion for column names, dependencies and declarations in `${ref(\"..\")}` and config block",
      anchor: "autocomplete",
      image: "/sources_autocompletion.gif",
    },
    {
      name: "Code actions",
      description: "Apply dry run suggestions at the speed of thought",
      anchor: "codeactions",
      image: "/quick_fix.png",
    },
    {
      name: "Run file(s)/tag(s)",
      description: "Run file(s)/tag(s), optionally with dependencies/dependents/full refresh using cli or <a href='https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/v1beta1.dataformclient' target='_blank' rel='noopener noreferrer'>Dataform API</a>",
      anchor: "filetagruns",
    },
    {
      name: "Format using Sqlfluff 🪄",
      description: "Format `.sqlx` files using <a href='https://github.com/sqlfluff/sqlfluff' target='_blank' rel='noopener noreferrer'>sqlfluff</a>",
      anchor: "formatting",
      image: "/formatting.gif",
    },
    {
      name: "BigQuery snippets",
      description: "Code snippets for generic BigQuery functions taken from <a href='https://github.com/shinichi-takii/vscode-language-sql-bigquery' target='_blank' rel='noopener noreferrer'>vscode-language-sql-bigquery</a> extension",
      anchor: "snippets",
    },
  ];

  const featureImages = features.filter(feature => feature.image);
  const currentFeature = features.find(f => f.anchor === selectedFeature) || features[0];
  
  const onSelect = useCallback(() => {
    if (!carouselApi) {return;}
    
    const selectedIndex = carouselApi.selectedScrollSnap();
    setCurrentSlide(selectedIndex);
    
    if (featureImages[selectedIndex]) {
      setSelectedFeature(featureImages[selectedIndex].anchor);
    }
  }, [carouselApi, featureImages]);

  useEffect(() => {
    if (!carouselApi) {return;}
    
    carouselApi.on("select", onSelect);
    // Initial slide
    onSelect();
    
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi, onSelect]);

  // Sync table selection with carousel
  useEffect(() => {
    if (!carouselApi) {return;}
    
    const featureIndex = featureImages.findIndex(f => f.anchor === selectedFeature);
    if (featureIndex !== -1 && featureIndex !== currentSlide) {
      carouselApi.scrollTo(featureIndex);
    }
  }, [selectedFeature, carouselApi, featureImages, currentSlide]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full px-10 md:px-10">
      {/* Features table */}
      <div className="w-full overflow-hidden">
        <div className="rounded-md border">
          <table className="w-full caption-bottom text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="h-12 px-4 text-left align-middle font-medium">Feature</th>
                <th className="h-12 px-4 text-left align-middle font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature, index) => (
                <tr
                  key={feature.anchor}
                  className={`${index % 2 === 0 ? "bg-background" : "bg-muted/50"} ${
                    selectedFeature === feature.anchor ? "bg-primary/10" : ""
                  } hover:bg-primary/5 cursor-pointer`}
                  onClick={() => setSelectedFeature(feature.anchor)}
                >
                  <td className="p-4 align-middle font-medium">
                    <Link 
                      href={`#${feature.anchor}`} 
                      className="hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedFeature(feature.anchor);
                      }}
                    >
                      {feature.name}
                    </Link>
                  </td>
                  <td className="p-4 align-middle" dangerouslySetInnerHTML={{ __html: feature.description as string }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="rounded-md border p-4 h-full flex flex-col">
          <h2 className="text-xl font-bold mb-2" id={currentFeature.anchor}>{currentFeature.name}</h2>
          <p className="mb-4" dangerouslySetInnerHTML={{ __html: currentFeature.description as string }}></p>
          
          <div className="relative flex-1 bg-muted/20 rounded-md overflow-hidden flex items-center justify-center" style={{ minHeight: '80vh' }}>
            <Carousel className="w-full h-full" setApi={setCarouselApi}>
              <CarouselContent className="h-full">
                {featureImages.map((feature) => {
                  const src = !mounted ? (feature.imageDark || feature.image!) : (resolvedTheme === 'light' ? feature.image! : (feature.imageDark || feature.image!));
                  return (
                  <CarouselItem key={feature.anchor} className="h-full">
                    <div className="relative w-full h-full flex items-center justify-center">
                      {feature.image ? (
                        <div className="relative w-full" style={{ height: '75vh' }}>
                          <Image 
                            src={src}
                            alt={`${feature.name} demonstration`}
                            fill
                            className="object-contain"
                            priority={feature.anchor === selectedFeature}
                          />
                        </div>
                      ) : (
                        <div className="text-muted text-center p-8">
                          Feature demonstration coming soon
                        </div>
                      )}
                    </div>
                  </CarouselItem>
                )})}
              </CarouselContent>
              <CarouselPrevious className="h-10 w-10 left-4" />
              <CarouselNext className="h-10 w-10 right-4" />
            </Carousel>
          </div>
        </div>
      </div>
    </div>
  );
} 