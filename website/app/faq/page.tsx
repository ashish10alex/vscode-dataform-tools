export default function FAQPage() {
  const faqs = [
    {
      question: "What is Dataform Tools?",
      answer:
        "Dataform Tools is a VSCode extension that enhances your development experience with Dataform, providing features for SQL compilation, schema exploration, and more efficient workflow management.",
    },
    {
      question: "How do I install Dataform Tools?",
      answer:
        "You can install Dataform Tools directly from the VSCode Marketplace. Simply search for 'Dataform Tools' in the Extensions tab of VSCode or click the Install Extension button on our website.",
    },
    {
      question: "What features does Dataform Tools offer?",
      answer:
        "Dataform Tools offers several key features including SQL compilation, schema exploration, code completion, and various development workflow enhancements specifically designed for Dataform projects.",
    },
    {
      question: "Is Dataform Tools free to use?",
      answer:
        "Yes, Dataform Tools is completely free and open-source. You can find the source code on our GitHub repository.",
    },
    {
      question: "How can I report issues or request features?",
      answer:
        "You can report issues or request features by creating an issue on our GitHub repository. We welcome community contributions and feedback.",
    },
  ];

  return (
    <div className="container py-8 md:py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight mb-8">
          Frequently Asked Questions
        </h1>
        <div className="space-y-6">
          {faqs.map((faq, index) => (
            <div key={index} className="border-b pb-6">
              <h3 className="text-lg font-semibold mb-2">{faq.question}</h3>
              <p className="text-muted-foreground">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 