const { smarthome } = require('actions-on-google');

/**
 * Initialize the Smart Home app instance.
 * It uses the SMART_HOME_KEY_JSON environment variable or a local JSON file.
 */
const appSmartHome = smarthome({
    jwt: process.env.SMART_HOME_KEY_JSON 
        ? JSON.parse(process.env.SMART_HOME_KEY_JSON) 
        : require('../smart-home-key.json') // Adjusted path for config folder
});

module.exports = appSmartHome;