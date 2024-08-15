## Usage

0. Please clone this repository in your terminal

```
git clone https://github.com/ashish10alex/test_dataform.git
```

1. Open this repository as the root of your VSCode work space in a new window

2. Install dataform cli

```
npm i -g @dataform/cli@3.0.0
```

3. Get the version, should match the version you install in step 1

```
dataform --version
```

4. Install necessary dependencies

```
dataform install
```

5. Compile your Dataform project

```
dataform compile
```

6. If step 4 executes without issues please try any features of [vscode-dataform-tools](https://github.com/ashish10alex/vscode-dataform-tools). I expect all
features to work that donot require your gcloud credentials. You can modify the sqlx and config files such that you can test your own gcp project on it too



## FAQ


