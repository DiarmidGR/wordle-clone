# Static Wordle app — no build step needed, just serve the files.
FROM nginx:1.27-alpine

# Copy the static assets into nginx's web root.
COPY . /usr/share/nginx/html

EXPOSE 80
