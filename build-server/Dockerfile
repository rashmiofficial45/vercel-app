FROM ubuntu

RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get upgrade -y
RUN apt-get install -y nodejs
RUN apt-get install -y git

WORKDIR /home/app
COPY main.sh main.sh
RUN chmod +x main.sh

ENTRYPOINT [ "/home/app/main.sh" ]
