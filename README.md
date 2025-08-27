<h1 align="center">Wall of Shame</h1>

<p align="center">
A web application for collecting, storing, and visualizing logs of OpenCanary connection attempts.
</p>

<h3 align="center"><a href="https://wos-demo.shrunbr.dev" target="_blank">Want to see a demo?</a></h3>

---

### Backend Flow

![Diagram depicting backend flow for the Wall of Shame](/docs/img/wos-backend-flow.png)

### Frontend Flow

![Diagram depicting frontend flow for the Wall of Shame](/docs/img/wos-frontend-flow.png)

## Features

- **Webhook ingestion:** Accepts log events via a simple HTTP POST API.
- **GeoIP enrichment:** Automatically enriches source IPs with country, city, ASN, ISP, and more using ip-api.com.
- **Source tracking:** Maintains a database of unique source IPs, including first seen, last seen, and number of times seen.
- **Frontend dashboard:** Displays grouped and paginated lists of source IPs, with country flags and detailed info dialogs.
- **API endpoints:** Query logs, source details, and batch geo info for integration or analysis.
- **Dockerized:** Easy to deploy with Docker.

## Technologies

- **Backend:** OpenCanary, FastAPI (Python), PostgreSQL
- **Frontend:** React (JavaScript)
- **GeoIP:** ip-api.com

## 🚀 Deployment

:warning: **OpenCanary is a honeypot. If you don't know what that is or what you are doing with this, go research it before moving forward with this deployment. Make sure you deploy this in a secure, segmented environment, preferrably a DMZ, a cloud server or somewhere that is firewalled or seperate from your own network. USE THIS AT YOUR OWN RISK!** :warning:

### All-in-One

Before we can deploy our Wall of Shame we need to setup our modify our `opencanary.conf` file, modify `docker-compose.yml` and setup our environment variables. In the provided configuration FTP, SSH and HTTP are already enabled.

Modify the `opencanary.conf` file first. For a configuration reference please visit [the OpenCanary configuration documentation.](https://opencanary.readthedocs.io/en/latest/starting/configuration.html). Please note, you MUST set a node ID in the `opencanary.conf` file and remove the comment I have there. If you do not do that OpenCanary will not start!

After you have setup your `opencanary.conf` file, go into the `docker-compose.yml` file and comment/uncomment/modify the service ports according to your `opencanary.conf` configuration. Included in `docker-compose.yml` is a configuration for cloudflared to expose the page publicly. If you do not wish to do this or use cloudflared please remove/comment out that portion.

Now that we have that all setup, we can get our environment variables going. To set these up you have two options...

1. Modify everything directly in the `docker-compose.yml` within the `infra/` folder 
2. Copy `.env.example` to `.env` and modify it as needed.

If you have gone with option 1, you need to run `docker compose up -d` within the `infra/` folder to start the stack.

If you have gone with option 2, you need to run `docker compose --env-file ../.env up -d` within the `infra/` folder to start the stack.

## Acknowledgements

[OpenCanary](https://github.com/thinkst/opencanary) is an open-source version of [Thinkst Canary](https://canary.tools/) built by Thinkst Applied Research. They do not promote or endorse this product.

[ip-api](https://ip-api.com/) is providing the geolocation information for the frontend application.

Icons for diagrams were sourced from [flaticon](https://www.flaticon.com/).