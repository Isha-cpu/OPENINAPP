const express = require("express");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");
const twilio = require("twilio");

const app = express();
app.use(express.json());

// JWT Configuration
const secretKey = "2GHR9nL574keGXHjamofCYr3GUzTMZvqCuJrZMgdwAs="; // Replace with your actual secret key

// Mock database tables
const tasks = [];
const subtasks = [];
const users = [{ id: 1, phone_number: "+12707196338", priority: 0 }];

//Twilio Configuration
const twilioAccountSid = "ACb8eea38e2c1e20468359efbda7f24e24";
const twilioAuthToken = "1ca653082647eca964d0b963e5ac82ea";
const twilioPhoneNumber = "+12707196338";
const twilioVoiceUrl = "https://ginger-lion-1496.twil.io/voice-calling-function";  
const twilioClient = new twilio(twilioAccountSid, twilioAuthToken);

// Priority Constants
const PRIORITY_URGENT = 0;
const PRIORITY_HIGH = 1;
const PRIORITY_MEDIUM = 2;
const PRIORITY_LOW = 3;

// Task Status Constants
const STATUS_TODO = "TODO";
const STATUS_IN_PROGRESS = "IN_PROGRESS";
const STATUS_DONE = "DONE";

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized - Token not provided" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized - Token not provided" });
  }

  jwt.verify(token, secretKey,{ algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      console.error("JWT Verification Error:", err);
      return res.status(403).json({ message: "Forbidden - Token verification failed" });
    }

    console.log("Decoded Token:", user);

    req.user = user;
    next();
  });
}

// Helper function to calculate priority based on due_date
function calculatePriority(due_date) {
  const date1 = new Date();
  const date2 = due_date;
  const diffTime = Math.abs(date2 - date1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return PRIORITY_URGENT;
  else if (diffDays === 1 || diffDays === 2) return PRIORITY_HIGH;
  else if (diffDays === 3 || diffDays === 4) return PRIORITY_MEDIUM;
  else return PRIORITY_LOW;
}

// Cron Job for changing priority of tasks based on due_date
cron.schedule("0 0 * * *", () => {
  updateTaskPriority();
});

// Helper function to update task priority based on due_date
function updateTaskPriority() {
  const currentDate = new Date();

  tasks.forEach((task) => {
    if (!task.deleted_at && task.due_date < currentDate) {
      task.priority = calculatePriority(task.due_date);
    }
  });
}

// Cron Job for voice calling using Twilio
cron.schedule("5 0 * * *", () => {
  voiceCalling();
});

// Helper function to make voice calls using Twilio based on priority
function voiceCalling() {
  const priorityUsers = users.sort((a, b) => a.priority - b.priority);

  for (const user of priorityUsers) {
    const userTasks = tasks.filter(task => task.priority === user.priority && task.status !== "DONE");

    if (userTasks.length > 0) {
      const taskToCall = userTasks[0];  
      twilioClient.calls
        .create({
          to: user.phone_number,
          from: twilioPhoneNumber,
          url: `${twilioVoiceUrl}?taskId=${taskToCall.id}`,  
        })
        .then((call) => console.log(`Call SID: ${call.sid}`))
        .catch((err) => console.error(err));
    }
  }
}

// API Routes

// 1. Create Task
app.post("/create_task",authenticateToken, (req, res) => {
  const data = req.body;
  data.due_date = new Date(data.due_date);
  if (!data.title || !data.description || !data.due_date) {
    return res.status(400).json({
      message: "Title, description, and due_date are required fields",
    });
  }

  const task = {
    id: tasks.length + 1,
    title: data.title,
    description: data.description,
    due_date: data.due_date,
    status: STATUS_TODO, // Initial status when no subtask is finished
    priority: calculatePriority(data.due_date),
    created_at: new Date(),
    updated_at: null,
    deleted_at: null,
  };

  tasks.push(task);
  res.status(201).json({ message: "Task created successfully" });
});

// Get all tasks
app.get("/get_tasks", (req, res) => {
  res.status(200).json(tasks);
});

//2 Create sub task
app.post("/create_subtask/:taskId", (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const { description } = req.body;

    // Validate if description is provided
    if (!description) {
      return res.status(400).json({ message: 'Description is a required field' });
    }

    // Find the task by ID
    const task = tasks.find((task) => task.id === taskId);

    // Check if the task exists
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Create the subtask
    const subtask = {
      id: subtasks.length + 1, // Generate a new subtask ID
      task_id: taskId,
      description: description,
      status: 0, // Initial status is incomplete
      created_at: new Date(),
      updated_at: null,
      deleted_at: null,
    };

    // Add the subtask to the subtasks array
    subtasks.push(subtask);

    res.status(201).json({ message: "Subtask created successfully", subtask: subtask });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

//3 Get task
app.get("/get_user_tasks", (req, res) => {
  try {
    // Extract query parameters
    const { priority, due_date, page, per_page } = req.query;

    // Convert page and per_page to integers with default values
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(per_page) || 10;

    // Filter tasks based on priority and due date
    // Filter tasks based on priority and due date
    let filteredTasks = tasks.filter((task) => {
      const isPriorityMatch = !priority || task.priority === parseInt(priority);
      const isDueDateMatch = !due_date || new Date(task.due_date).toISOString().split("T")[0] === due_date;
      return isPriorityMatch && isDueDateMatch;
    });

    // Sort tasks based on priority and due date
    filteredTasks = filteredTasks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.due_date - b.due_date;
    });

    // Implement pagination
    const startIndex = (pageNumber - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedTasks = filteredTasks.slice(startIndex, endIndex);

    res.json({ tasks: paginatedTasks, totalTasks: filteredTasks.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


//4 Get Subtask
app.get("/get_subtasks", (req, res) => {
  try {
    // Extract query parameter
    const { task_id } = req.query;

    // Filter subtasks based on task_id if provided
    let filteredSubtasks = subtasks;
    if (task_id) {
      const parsedTaskId = parseInt(task_id);
      filteredSubtasks = filteredSubtasks.filter((subtask) => subtask.task_id === parsedTaskId);
    }

    res.json({ subtasks: filteredSubtasks });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

//5 Update Task
// Helper function to update the status of a task based on subtasks
function updateTaskStatus(task) {
  const taskSubtasks = subtasks.filter((subtask) => subtask.task_id === task.id);

  const completedSubtasks = taskSubtasks.filter((subtask) => subtask.status === 1);

  if (completedSubtasks.length === taskSubtasks.length) {
    task.status = STATUS_DONE;
  } else if (completedSubtasks.length > 0) {
    task.status = STATUS_IN_PROGRESS;
  } else {
    task.status = STATUS_TODO;
  }

  return true;
}

app.put("/update_task/:taskId", (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const { due_date, status } = req.body;

    // Find the task by ID
    const taskToUpdate = tasks.find((task) => task.id === taskId);

    // Check if the task exists
    if (!taskToUpdate) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Update the task
    updateTaskStatus(taskToUpdate);

    if (status && (status === STATUS_TODO || status === STATUS_DONE)) {
      // Update the task status directly if the status is provided
      taskToUpdate.status = status;
    }

    // Update due_date if provided
    if (due_date) {
      taskToUpdate.due_date = new Date(due_date);
    }

    taskToUpdate.updated_at = new Date();

    res.json({ message: "Task updated successfully", task: taskToUpdate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


//6 Update Subtask Status

// Helper function to update the status of a task based on subtasks
function updateTaskStatus(task) {
  const taskSubtasks = subtasks.filter((subtask) => subtask.task_id === task.id);

  const completedSubtasks = taskSubtasks.filter((subtask) => subtask.status === 1);

  if (completedSubtasks.length === taskSubtasks.length) {
    task.status = STATUS_DONE;
  } else if (completedSubtasks.length > 0) {
    task.status = STATUS_IN_PROGRESS;
  } else {
    task.status = STATUS_TODO;
  }

  return true;
}

app.put("/update_subtask/:subtaskId", (req, res) => {
  try {
    const subtaskId = parseInt(req.params.subtaskId);
    const { status } = req.body;

    // Find the subtask by ID
    const subtaskToUpdate = subtasks.find((subtask) => subtask.id === subtaskId);

    // Check if the subtask exists
    if (!subtaskToUpdate) {
      return res.status(404).json({ message: "Subtask not found" });
    }

    // Validate the status value (0 or 1)
    if (status !== 0 && status !== 1) {
      return res.status(400).json({ message: "Invalid status value. It should be 0 or 1." });
    }

    // Update the status of the subtask
    subtaskToUpdate.status = status;
    subtaskToUpdate.updated_at = new Date();

    // Update the status of the task based on subtasks
    const task = tasks.find((task) => task.id === subtaskToUpdate.task_id);
    if (task) {
      updateTaskStatus(task);
    }

    res.json({ message: "Subtask status updated successfully", subtask: subtaskToUpdate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Helper function for soft deletion
function softDelete(array, id) {
  const itemToDelete = array.find((item) => item.id === id);

  if (itemToDelete) {
    itemToDelete.deleted_at = new Date();
  }
}

// 7. Delete Task (Soft Deletion)
app.delete("/delete_task/:taskId", (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);

    // Soft delete the task
    softDelete(tasks, taskId);

    res.json({ message: "Task deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// 8. Delete Subtask (Soft Deletion)
app.delete("/delete_subtask/:subtaskId", (req, res) => {
  try {
    const subtaskId = parseInt(req.params.subtaskId);

    // Soft delete the subtask
    softDelete(subtasks, subtaskId);

    res.json({ message: "Subtask deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
