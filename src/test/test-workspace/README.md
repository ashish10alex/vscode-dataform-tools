
### How to use

<b>Option 1: </b>

Open the repository in github code spaces by clicking on the "Code" button on the github repository page and selecting the  "Codespaces" tab. It uses the `devcontainer.json` file in this repo to build a 
container with the [Dataform tools](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) extension and dependencies such as gcloud and dataform cli preconfigured. **Note** that it takes approximately 5 mins for the container to build, so grab a cup of coffe while its getting spun up !

<b>Option 2: </b>

Open the repository in a [VSCode Dev Container](https://code.visualstudio.com/docs/devcontainers/containers)  and run the following 

```bash
gcloud init
gloud auth application-default login
gcloud config set project drawingfire-b72a8 # replace with your gcp project id
```

#### TODOs

- [ ] Add example of using a javascript function 
- [ ] Create another dataset in BigQuery and connect to it in the pipeline

#### Personal notes 

Create a new Dataform project

```bash
dataform init --default-database drawingfire-b72a8 --default-location europe-west2
```
