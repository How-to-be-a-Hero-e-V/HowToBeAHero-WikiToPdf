// override the default parsoid port based on config
const path = require('path');
const fs = require('fs');

fs.readFile(path.join(__dirname, "config.yaml"), 'utf8', function(err, data) {
	if (err) {
		return console.log(err);
	}

	var result = data.replace(/serverPort: .*/, `serverPort: ${process.env.npm_package_config_parsoidPort}`);
	fs.writeFileSync(path.join(__dirname, "config.yaml"), result, 'utf8');

	fs.createReadStream(path.join(__dirname, "config.yaml")).pipe(fs.createWriteStream(path.join(__dirname, "node_modules", "parsoid", "config.yaml")));
});

fs.readFile(path.join(__dirname, "index.js"), 'utf8', function(err, data) {
	if (err) {
		return console.log(err);
	}

	var result = data.replace("    base: 'http://localhost:3000'", `    base: 'http://localhost:${process.env.npm_package_config_parsoidPort}'`);
	fs.writeFileSync(path.join(__dirname, "index.js"), result, 'utf8');
});


