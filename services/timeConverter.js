//v1.6

const moment = require("moment-timezone");

// Single function to format date and time
function singleCustomDateTime(data, dateFormat, timeZone, dateSplit) {
  const dateTimeMoment = moment(data.createdDateTime).tz(timeZone);

  // Format the date with split character
  let createdDate = dateTimeMoment.format(dateFormat);
  if (dateSplit) {
    createdDate = createdDate.replace(/\//g, dateSplit);
  }

  const createdTime = dateTimeMoment.format('hh:mm:ss A');

  return {
    ...data,
    createdDate,
    createdTime
  };
}

// Multiple function to format date and time
function multiCustomDateTime(objects, dateFormat, timeZone, dateSplit) {
  if (!Array.isArray(objects)) {
    throw new Error("The first parameter must be an array of objects.");
  }

  return objects.map(obj => {    
    // if (!obj.createdDateTime) {
    //   throw new Error("Each object must have a createdDateTime property.");
    // }

    const formatted = singleCustomDateTime(obj, dateFormat, timeZone, dateSplit);

    // Return a new object with the formatted data included
    return {
      ...obj,
      createdDate: formatted.createdDate,
      createdTime: formatted.createdTime,
    };
  });
}

module.exports = { singleCustomDateTime, multiCustomDateTime };
