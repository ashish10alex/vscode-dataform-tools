export default function FAQPage() {
  const faqs = [
    {
      question: "What operating systems does Dataform Tools support?",
      answer:
        "Dataform Tools supports Windows, MacOS, and Linux.",
    },
    {
      question: "What is the minimum version of VS Code required to use Dataform Tools?",
      answer:
        "Dataform Tools requires VS Code version 1.89.0 or higher.",
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
              <h3 className="text-lg font-semibold mb-2">
                <span className="mr-2 text-primary">{index + 1}.</span>
                {faq.question}
              </h3>
              <p className="text-muted-foreground">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 