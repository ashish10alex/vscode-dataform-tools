notebook({
    filename: "test_one.ipynb",
    dependencyTargets: [{
        name: "0100_CLUBS",
      }],
    tags: ["new_tag"]
});


notebook({
    filename: "test_two.ipynb",
    dependencyTargets: [{
        name: "0100_PLAYERS",
      }],
    tags: ["tag2"]
});