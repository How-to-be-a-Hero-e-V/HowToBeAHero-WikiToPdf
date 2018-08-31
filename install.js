const fs = require('fs');
const path = require('path');
fs.createReadStream(path.join(__dirname, "config.yaml")).pipe(fs.createWriteStream(path.join(__dirname, "node_modules", "parsoid", "config.yaml")));
