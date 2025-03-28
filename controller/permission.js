const User = require('../database/model/user');
const Role = require('../database/model/role');
const ActivityLog = require('../database/model/activityLog');
const moment = require("moment-timezone");


const checkPermission = (permissionAction) => {
  return async (req, res, next) => {
    try {
      // Fetch user using userId from req.user
      if (!req.user.id) {
        return res.status(401).json({ message: 'Unauthorized: Missing user credentials' });
      }
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      const organizationId= req.user.organizationId

      // Fetch the role associated with the user
      const role = await Role.findOne({ roleName: user.role, organizationId });
      if (!role) {
        return res.status(401).json({ message: 'Role not found' });
      }
      
      const generatedDateTime = generateTimeAndDateForDB(
        "Asia/Kolkata",
        "DD/MM/YY",
        "/"
      );
      const actionTime = generatedDateTime.dateTime;

      // Find the permission in the role's permissions array
      const permission = role.permissions.find(p => p.note === permissionAction);
      // console.log( "user  ",role);
      
      

      // If the permission exists, log the activity and grant access
      if (permission) {
        const activity = new ActivityLog({
          userName: user.userName, // Assuming your User model has a username field
          activity: `Accessed ${permission.note}`, // Log the note associated with the permission
          timestamp: actionTime,
        });
        await activity.save();
                

        return next();  // Permission granted, move to next middleware or route handler
      } else {
        // Log the unauthorized access attempt
        const unauthorizedActivity = new ActivityLog({
          userName: user.userName,
          activity: `Tried to access ${permissionAction} without proper permissions`,
          timestamp: actionTime,
          reqBody: JSON.stringify(req.body),
        });
        await unauthorizedActivity.save();

        // Permission not found, deny access
        return res.status(403).json({ message: `Access denied: Insufficient permissions to perform ${permissionAction}` });
      }
    } catch (err) {
      console.error('Error in checkPermission:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
};


// Function to generate time and date for storing in the database
function generateTimeAndDateForDB(
  timeZone,
  dateFormat,
  dateSplit,
  baseTime = new Date(),
  timeFormat = "HH:mm:ss",
  timeSplit = ":"
) {
  // Convert the base time to the desired time zone
  const localDate = moment.tz(baseTime, timeZone);

  // Format date and time according to the specified formats
  let formattedDate = localDate.format(dateFormat);

  // Handle date split if specified
  if (dateSplit) {
    // Replace default split characters with specified split characters
    formattedDate = formattedDate.replace(/[-/]/g, dateSplit); // Adjust regex based on your date format separators
  }

  const formattedTime = localDate.format(timeFormat);
  const timeZoneName = localDate.format("z"); // Get time zone abbreviation

  // Combine the formatted date and time with the split characters and time zone
  const dateTime = `${formattedDate} ${formattedTime
    .split(":")
    .join(timeSplit)} (${timeZoneName})`;

  return {
    date: formattedDate,
    time: `${formattedTime} (${timeZoneName})`,
    dateTime: dateTime,
  };
}


module.exports = checkPermission;


