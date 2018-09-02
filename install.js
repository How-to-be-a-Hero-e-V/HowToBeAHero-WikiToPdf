// override the default parsoid port based on config
const path = require('path');
const fs = require('fs');

const pathToConfig = path.join(__dirname, "config.yaml");

fs.readFile(pathToConfig, 'utf8', function(err, data) {
	if (err) {
		return console.log(err);
	}

	var result = data.replace(/serverPort: \d*/, `serverPort: ${process.env.npm_package_config_parsoidPort}`);
	fs.writeFileSync(pathToConfig, result, 'utf8');

	fs.createReadStream(pathToConfig).pipe(fs.createWriteStream(path.join(__dirname, "node_modules", "parsoid", "config.yaml")));
});


