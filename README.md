# copy-over

> A GitHub App built with [Probot](https://github.com/probot/probot) that Copy GitHub issues to ADO boards

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t copy-over .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> copy-over
```

## License

[ISC](LICENSE) © 2025 Alex Darr
