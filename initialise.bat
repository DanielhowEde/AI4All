docker run -it --rm --env-file .env -v "${PWD}:/workspace" -w /workspace claude-flow claude-flow init

docker run -it --rm --env-file .env v "${PWD}:/workspace" -w /workspace claude-flow claude-flow swarm init --v3-mode

docker run -d --name cf-queen --env-file .env -v "${PWD}:/workspace" -w /workspace claude-flow claude-flow start

